"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const configHandler = require("../api/config.js");
const healthHandler = require("../api/health.js");
const signalHandler = require("../api/signal.js");

const API_KEY = "sk-ant-test-key-123456789";
const OTHER_API_KEY = "sk-ant-another-key-987654321";
const REPLACED_API_KEY = "sk-ant-replaced-key-123456789";
const REPLACEMENT_API_KEY = "sk-ant-replacement-key-987654321";
const FIRST_IP = "198.51.100.20";
const SECOND_IP = "203.0.113.80";
const THIRD_IP = "192.0.2.45";
const FOURTH_IP = "192.0.2.80";
const ORIGIN = "https://remzaitrading.vercel.app";
const database = new Map();
const limits = new Map();
let anthropicCalls = [];
let anthropicHandler = () => ({
  ok: true,
  status: 200,
  json: async () => ({ content: [{ type: "text", text: "BUY 80 500 300" }] }),
});

process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
process.env.CONFIG_ENCRYPTION_KEY = "a".repeat(64);

function redisResult(result, status = 200) {
  return {
    ok: status === 200,
    status,
    json: async () => ({ result }),
  };
}

function mockRedis(command) {
  if (command[0] === "PING")
    return redisResult("PONG");
  if (command[0] === "GET")
    return redisResult(database.get(command[1]) ?? null);
  if (command[0] !== "EVAL")
    throw new Error(`Unexpected Redis command: ${command[0]}`);

  const script = command[1];
  const keyCount = Number(command[2]);
  const keys = command.slice(3, 3 + keyCount);
  const args = command.slice(3 + keyCount);
  if (script.includes("remz_claim_v1")) {
    const [claimKey, ipKey, configKey] = keys;
    const [ipHash, apiKeyHash, record, , claimPrefix, configPrefix] = args;
    const currentOwner = database.get(claimKey);
    if (currentOwner && currentOwner !== ipHash)
      return redisResult(-1);
    const previousKey = database.get(ipKey);
    if (previousKey && previousKey !== apiKeyHash) {
      if (database.get(claimPrefix + previousKey) !== ipHash)
        return redisResult(-3);
      database.delete(claimPrefix + previousKey);
      database.delete(configPrefix + previousKey);
    }
    database.set(claimKey, ipHash);
    database.set(ipKey, apiKeyHash);
    database.set(configKey, record);
    return redisResult(1);
  }
  if (script.includes("remz_delete_v1")) {
    const [ipKey] = keys;
    const [claimPrefix, configPrefix, ipHash] = args;
    const apiKeyHash = database.get(ipKey);
    if (!apiKeyHash)
      return redisResult(0);
    if (database.get(claimPrefix + apiKeyHash) !== ipHash)
      return redisResult(-1);
    database.delete(claimPrefix + apiKeyHash);
    database.delete(configPrefix + apiKeyHash);
    database.delete(ipKey);
    return redisResult(1);
  }
  if (script.includes("remz_limit_v1")) {
    const [key] = keys;
    const count = (limits.get(key) || 0) + 1;
    limits.set(key, count);
    return redisResult(count);
  }
  throw new Error("Unexpected Redis script");
}

const originalFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  if (String(url).startsWith("https://redis.example")) {
    assert.equal(options.headers.Authorization, "Bearer test-token");
    return mockRedis(JSON.parse(options.body));
  }
  const call = { url: String(url), options };
  anthropicCalls.push(call);
  return anthropicHandler(call);
};

function createResponse() {
  return {
    headers: {},
    statusCode: 0,
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body = "") {
      this.body = body;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

function createRequest(method, ip, body, extraHeaders = {}) {
  const headers = {
    origin: ORIGIN,
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(JSON.stringify(body || {}))),
    "x-forwarded-for": ip,
    ...extraHeaders,
  };
  return { method, headers, body };
}

async function configure(ip = FIRST_IP, apiKey = API_KEY, lotSize = 0.05) {
  const response = createResponse();
  await configHandler(createRequest("POST", ip, {
    api_key: apiKey,
    lot_size: lotSize,
    model: "claude-sonnet-5-5",
  }), response);
  return response;
}

test("health reports the hosted settings store ready", async () => {
  const response = createResponse();
  await healthHandler({ method: "GET", headers: {} }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "ready");
});

test("dashboard settings save encrypted API keys and return lot/model only", async () => {
  const response = await configure();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    saved: true,
    configured: true,
    lot_size: 0.05,
    model: "claude-sonnet-5-5",
  });
  assert.equal(response.body.includes(API_KEY), false);
  assert.equal([...database.values()].join("|").includes(API_KEY), false);

  const status = createResponse();
  await configHandler(createRequest("GET", FIRST_IP), status);
  assert.equal(status.statusCode, 200);
  assert.deepEqual(status.json(), {
    configured: true,
    lot_size: 0.05,
    model: "claude-sonnet-5-5",
  });
  assert.equal(status.body.includes(API_KEY), false);
});

test("lot size and model can be changed without resending the saved API key", async () => {
  await configure();
  const response = createResponse();
  await configHandler(createRequest("POST", FIRST_IP, {
    api_key: "",
    lot_size: 0.12,
    model: "claude-sonnet-4-5",
  }), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().lot_size, 0.12);

  const status = createResponse();
  await configHandler(createRequest("GET", FIRST_IP), status);
  assert.equal(status.json().model, "claude-sonnet-4-5");
  assert.equal(status.json().lot_size, 0.12);
});

test("the first public IP claims an API key and other IPs cannot use it", async () => {
  await configure(FIRST_IP);
  const otherNetwork = createResponse();
  await configHandler(createRequest("POST", SECOND_IP, {
    api_key: API_KEY,
    lot_size: 0.01,
    model: "claude-sonnet-5-5",
  }), otherNetwork);
  assert.equal(otherNetwork.statusCode, 409);

  const status = createResponse();
  await configHandler(createRequest("GET", SECOND_IP), status);
  assert.equal(status.statusCode, 404);
});

test("a public IP can replace its key and release the old key claim", async () => {
  await configure(THIRD_IP, REPLACED_API_KEY, 0.05);
  const replacement = await configure(THIRD_IP, REPLACEMENT_API_KEY, 0.2);
  assert.equal(replacement.statusCode, 200);

  const oldKeyClaim = await configure(FOURTH_IP, REPLACED_API_KEY, 0.01);
  assert.equal(oldKeyClaim.statusCode, 200);

  const current = createResponse();
  await configHandler(createRequest("GET", THIRD_IP), current);
  assert.equal(current.json().lot_size, 0.2);
});

test("the EA receives signal and lot settings only from its configured public IP", async () => {
  await configure(FIRST_IP, API_KEY, 0.08);
  anthropicCalls = [];
  anthropicHandler = () => ({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: "text", text: "SELL 70 400 600" }] }),
  });
  const response = createResponse();
  await signalHandler(createRequest("POST", FIRST_IP, {
    market_data: "M5 market data for test",
  }), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { signal: "SELL 70 400 600", lot_size: 0.08 });
  assert.equal(anthropicCalls.length, 1);
  assert.equal(anthropicCalls[0].options.headers["x-api-key"], API_KEY);
  assert.equal(response.body.includes(API_KEY), false);
});

test("signal requests without this network's saved settings are rejected", async () => {
  anthropicCalls = [];
  const response = createResponse();
  await signalHandler(createRequest("POST", SECOND_IP, {
    market_data: "M5 market data",
  }), response);
  assert.equal(response.statusCode, 401);
  assert.equal(anthropicCalls.length, 0);
});

test("upstream API errors never return the saved API key", async () => {
  await configure(FIRST_IP);
  anthropicHandler = () => ({
    ok: false,
    status: 401,
    json: async () => ({
      error: { message: `Invalid API key ${API_KEY}` },
    }),
  });
  const response = createResponse();
  await signalHandler(createRequest("POST", FIRST_IP, {
    market_data: "M5 market data",
  }), response);
  assert.equal(response.statusCode, 502);
  assert.equal(response.body.includes(API_KEY), false);
});

test("invalid Claude output becomes HOLD with the configured lot size", async () => {
  await configure(FIRST_IP);
  anthropicHandler = () => ({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: "text", text: "Unexpected output" }] }),
  });
  const response = createResponse();
  await signalHandler(createRequest("POST", FIRST_IP, {
    market_data: "M5 market data",
  }), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().signal, "HOLD 0 0 0");
  assert.equal(response.json().lot_size, 0.05);
});

test("invalid settings and foreign browser origins are rejected", async () => {
  const invalid = createResponse();
  await configHandler(createRequest("POST", FIRST_IP, {
    api_key: API_KEY,
    lot_size: 1000,
    model: "claude-sonnet-5-5",
  }), invalid);
  assert.equal(invalid.statusCode, 400);

  const foreign = createResponse();
  await configHandler(createRequest("POST", FIRST_IP, {
    api_key: API_KEY,
    lot_size: 0.01,
    model: "claude-sonnet-5-5",
  }, { origin: "https://attacker.example" }), foreign);
  assert.equal(foreign.statusCode, 403);
});

test("removing settings frees the key for a new public IP", async () => {
  await configure(FIRST_IP);
  const removed = createResponse();
  await configHandler(createRequest("DELETE", FIRST_IP), removed);
  assert.equal(removed.statusCode, 200);
  assert.equal(removed.json().deleted, true);

  const claimed = await configure(SECOND_IP);
  assert.equal(claimed.statusCode, 200);
});

test.after(() => {
  global.fetch = originalFetch;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.CONFIG_ENCRYPTION_KEY;
});
