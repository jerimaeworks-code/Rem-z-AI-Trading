"use strict";

const {
  runSignalAnalysis,
  InvalidSignalError,
  MAX_MARKET_DATA_CHARS,
} = require("../localhost_bridge.js");
const {
  clientIp,
  fingerprints,
  loadConfigForIp,
  checkRateLimit,
} = require("../hosted_config.js");

const MAX_BODY_BYTES = 64 * 1024;
const ALLOWED_ORIGIN = "https://remzaitrading.vercel.app";

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Vary", "Origin");
  response.end(JSON.stringify(payload));
}

function requestPayload(request) {
  if (typeof request.body === "string")
    return JSON.parse(request.body);
  return request.body;
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  const origin = request.headers.origin;

  if (origin && origin !== ALLOWED_ORIGIN) {
    sendJson(response, 403, { error: "Cross-origin requests are not allowed" });
    return;
  }
  if (request.method === "OPTIONS") {
    if (origin === ALLOWED_ORIGIN) {
      response.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
      response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, OPTIONS");
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }
  if (origin === ALLOWED_ORIGIN)
    response.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    sendJson(response, 415, { error: "Content-Type must be application/json" });
    return;
  }

  const declaredLength = Number(request.headers["content-length"] || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    sendJson(response, 413, { error: "Request body is too large" });
    return;
  }

  let payload;
  try {
    payload = requestPayload(request);
  } catch {
    sendJson(response, 400, { error: "Request body must be valid JSON" });
    return;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    sendJson(response, 400, { error: "Request body must be a JSON object" });
    return;
  }
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_BODY_BYTES) {
    sendJson(response, 413, { error: "Request body is too large" });
    return;
  }
  if (typeof payload.market_data !== "string" ||
      payload.market_data.length === 0 ||
      payload.market_data.length > MAX_MARKET_DATA_CHARS) {
    sendJson(response, 400, {
      error: "market_data must be a non-empty string within the size limit",
    });
    return;
  }

  let config;
  let ipHash;
  try {
    const ip = clientIp(request);
    ipHash = fingerprints(ip, "").ipHash;
    if (!(await checkRateLimit(ipHash))) {
      response.setHeader("Retry-After", "60");
      sendJson(response, 429, { error: "This network has reached the signal request limit. Try again in one minute." });
      return;
    }
    config = await loadConfigForIp(ipHash);
  } catch (error) {
    console.error(`Hosted bridge configuration lookup failed: ${error.message}`);
    sendJson(response, 503, { error: "Hosted bridge settings are temporarily unavailable" });
    return;
  }
  if (!config) {
    sendJson(response, 401, {
      error: "No API key is configured for this public IP. Open /dashboard on this network and save your bridge settings.",
    });
    return;
  }
  try {
    const result = await runSignalAnalysis(payload.market_data, config.apiKey, config.model);
    sendJson(response, 200, {
      signal: result.signal,
      lot_size: config.lotSize,
    });
  } catch (error) {
    if (error instanceof InvalidSignalError) {
      sendJson(response, 200, {
        signal: "HOLD 0 0 0",
        lot_size: config.lotSize,
        reason: "Claude response could not be verified",
      });
      return;
    }
    const message = (error instanceof Error ? error.message : "Claude request failed")
      .replaceAll(config.apiKey, "[redacted]")
      .slice(0, 240);
    sendJson(response, 502, { error: message || "Claude request failed" });
  }
};
