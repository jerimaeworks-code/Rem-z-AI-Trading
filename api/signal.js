"use strict";

const {
  runSignalAnalysis,
  InvalidSignalError,
  MAX_MARKET_DATA_CHARS,
} = require("../localhost_bridge.js");

const MAX_BODY_BYTES = 64 * 1024;
const MAX_API_KEY_CHARS = 512;
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
      response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Anthropic-Api-Key");
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

  const apiKey = request.headers["x-anthropic-api-key"];
  if (typeof apiKey !== "string" ||
      apiKey.trim().length < 10 ||
      apiKey.trim().length > MAX_API_KEY_CHARS) {
    sendJson(response, 401, { error: "Enter your Anthropic API key in the EA inputs" });
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
  const model = payload.model === undefined ? "claude-sonnet-5-5" : payload.model;
  if (typeof model !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(model)) {
    sendJson(response, 400, { error: "Model name contains invalid characters" });
    return;
  }

  try {
    const result = await runSignalAnalysis(payload.market_data, apiKey.trim(), model);
    sendJson(response, 200, { signal: result.signal });
  } catch (error) {
    if (error instanceof InvalidSignalError) {
      sendJson(response, 200, {
        signal: "HOLD 0 0 0",
        reason: "Claude response could not be verified",
      });
      return;
    }
    const message = (error instanceof Error ? error.message : "Claude request failed")
      .replaceAll(apiKey.trim(), "[redacted]")
      .slice(0, 240);
    sendJson(response, 502, { error: message || "Claude request failed" });
  }
};
