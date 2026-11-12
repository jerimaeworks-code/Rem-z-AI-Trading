"use strict";

const { createCipheriv, createDecipheriv, createHmac, randomBytes } =
  require("node:crypto");
const { isIP } = require("node:net");

const KEY_PREFIX = "remz:v1";
const CONFIG_TTL_SECONDS = 60 * 60 * 24 * 90;

function getEncryptionKey() {
  const value = process.env.CONFIG_ENCRYPTION_KEY || "";
  if (!/^[a-fA-F0-9]{64}$/.test(value))
    throw new Error("Hosted settings storage is not configured");
  return Buffer.from(value, "hex");
}

function getRedisSettings() {
  const url = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!/^https:\/\//i.test(url) || !token)
    throw new Error("Hosted settings storage is not configured");
  return { url, token };
}

async function redisCommand(...command) {
  const { url, token } = getRedisSettings();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Hosted settings storage returned an invalid response");
  }
  if (!response.ok || result.error)
    throw new Error("Hosted settings storage request failed");
  return result.result;
}

function clientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  const candidates = Array.isArray(forwarded)
    ? forwarded
    : typeof forwarded === "string" ? forwarded.split(",") : [];
  for (const candidate of candidates) {
    const address = candidate.trim();
    if (isIP(address)) return address.toLowerCase();
  }
  throw new Error("Could not determine your public IP address");
}

function fingerprints(ip, apiKey) {
  const encryptionKey = getEncryptionKey();
  const ipHash = createHmac("sha256", encryptionKey).update(ip).digest("hex");
  const apiKeyHash = createHmac("sha256", encryptionKey).update(apiKey).digest("hex");
  return { ipHash, apiKeyHash };
}

function apiKeyFingerprint(apiKey) {
  const encryptionKey = getEncryptionKey();
  return createHmac("sha256", encryptionKey).update(apiKey).digest("hex");
}

function encryptApiKey(apiKey) {
  const encryptionKey = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  });
}

function decryptApiKey(record) {
  const encrypted = JSON.parse(record);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function keyForIp(ipHash) {
  return `${KEY_PREFIX}:ip:${ipHash}`;
}

function keyForClaim(apiKeyHash) {
  return `${KEY_PREFIX}:claim:${apiKeyHash}`;
}

function keyForConfig(apiKeyHash) {
  return `${KEY_PREFIX}:config:${apiKeyHash}`;
}

async function loadConfigForIp(ipHash) {
  const apiKeyHash = await redisCommand("GET", keyForIp(ipHash));
  if (typeof apiKeyHash !== "string" || !/^[a-f0-9]{64}$/.test(apiKeyHash))
    return null;
  const ownerIpHash = await redisCommand("GET", keyForClaim(apiKeyHash));
  if (ownerIpHash !== ipHash)
    throw new Error("Hosted API-key ownership record is inconsistent");
  const saved = await redisCommand("GET", keyForConfig(apiKeyHash));
  if (typeof saved !== "string")
    throw new Error("Hosted bridge settings could not be loaded");
  let config;
  try {
    config = JSON.parse(saved);
  } catch {
    throw new Error("Hosted bridge settings are invalid");
  }
  if (!Number.isFinite(config.lot_size) ||
      config.lot_size < 0.01 || config.lot_size > 100 ||
      typeof config.encrypted_api_key !== "string" ||
      typeof config.model !== "string")
    throw new Error("Hosted bridge settings are invalid");
  return {
    apiKeyHash,
    lotSize: config.lot_size,
    model: config.model,
    apiKey: decryptApiKey(config.encrypted_api_key),
  };
}

const CLAIM_SCRIPT = `-- remz_claim_v1
local key_owner = redis.call('GET', KEYS[1])
if key_owner and key_owner ~= ARGV[1] then return -1 end
local ip_key = redis.call('GET', KEYS[2])
if ip_key and ip_key ~= ARGV[2] then
  local old_owner = redis.call('GET', ARGV[5] .. ip_key)
  if old_owner ~= ARGV[1] then return -3 end
  redis.call('DEL', ARGV[5] .. ip_key)
  redis.call('DEL', ARGV[6] .. ip_key)
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[4])
redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[4])
return 1`;

const DELETE_SCRIPT = `-- remz_delete_v1
local api_key_hash = redis.call('GET', KEYS[1])
if not api_key_hash then return 0 end
local owner_ip = redis.call('GET', ARGV[1] .. api_key_hash)
if owner_ip ~= ARGV[3] then return -1 end
redis.call('DEL', ARGV[1] .. api_key_hash)
redis.call('DEL', ARGV[2] .. api_key_hash)
redis.call('DEL', KEYS[1])
return 1`;

const RATE_LIMIT_SCRIPT = `-- remz_limit_v1
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count`;

async function saveConfig(ipHash, apiKey, lotSize, model) {
  const apiKeyHash = apiKeyFingerprint(apiKey);
  const encryptedApiKey = encryptApiKey(apiKey);
  const record = JSON.stringify({
    encrypted_api_key: encryptedApiKey,
    lot_size: lotSize,
    model,
  });
  const result = await redisCommand(
    "EVAL",
    CLAIM_SCRIPT,
    "3",
    keyForClaim(apiKeyHash),
    keyForIp(ipHash),
    keyForConfig(apiKeyHash),
    ipHash,
    apiKeyHash,
    record,
    String(CONFIG_TTL_SECONDS),
    `${KEY_PREFIX}:claim:`,
    `${KEY_PREFIX}:config:`,
  );
  if (result === -1) return "key_claimed";
  if (result === -3)
    throw new Error("Hosted API-key ownership record is inconsistent");
  if (result !== 1)
    throw new Error("Hosted bridge settings could not be saved");
  return "saved";
}

async function deleteConfig(ipHash) {
  const result = await redisCommand(
    "EVAL",
    DELETE_SCRIPT,
    "1",
    keyForIp(ipHash),
    `${KEY_PREFIX}:claim:`,
    `${KEY_PREFIX}:config:`,
    ipHash,
  );
  if (result === -1)
    throw new Error("Hosted API-key ownership record is inconsistent");
  return result === 1;
}

async function checkStoreReady() {
  return (await redisCommand("PING")) === "PONG";
}

async function checkRateLimit(ipHash) {
  const result = await redisCommand(
    "EVAL",
    RATE_LIMIT_SCRIPT,
    "1",
    `${KEY_PREFIX}:rate:${ipHash}`,
    "60",
  );
  return Number(result) <= 12;
}

module.exports = {
  clientIp,
  fingerprints,
  loadConfigForIp,
  saveConfig,
  deleteConfig,
  checkStoreReady,
  checkRateLimit,
};
