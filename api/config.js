"use strict";

const {
  clientIp,
  fingerprints,
  loadConfigForIp,
  saveConfig,
  deleteConfig,
} = require("../hosted_config.js");

const MAX_BODY_BYTES = 4096;
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

function readPayload(request) {
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
  if (request.method !== "GET" && request.method !== "POST" &&
      request.method !== "DELETE") {
    response.setHeader("Allow", "GET, POST, DELETE");
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  let ipHash;
  try {
    const ip = clientIp(request);
    ipHash = fingerprints(ip, "").ipHash;
  } catch (error) {
    sendJson(response, 503, { error: error.message });
    return;
  }

  try {
    if (request.method === "GET") {
      const config = await loadConfigForIp(ipHash);
      if (!config) {
        sendJson(response, 404, {
          configured: false,
          error: "No bridge settings are registered for this public IP",
        });
        return;
      }
      sendJson(response, 200, {
        configured: true,
        lot_size: config.lotSize,
        model: config.model,
      });
      return;
    }

    if (request.method === "DELETE") {
      const deleted = await deleteConfig(ipHash);
      sendJson(response, 200, { deleted });
      return;
    }

    if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      sendJson(response, 415, { error: "Content-Type must be application/json" });
      return;
    }
    const declaredLength = Number(request.headers["content-length"] || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      sendJson(response, 413, { error: "Settings request is too large" });
      return;
    }

    let payload;
    try {
      payload = readPayload(request);
    } catch {
      sendJson(response, 400, { error: "Request body must be valid JSON" });
      return;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      sendJson(response, 400, { error: "Settings must be a JSON object" });
      return;
    }
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_BODY_BYTES) {
      sendJson(response, 413, { error: "Settings request is too large" });
      return;
    }

    let apiKey = typeof payload.api_key === "string"
      ? payload.api_key.trim()
      : "";
    const lotSize = payload.lot_size;
    const model = payload.model;
    if (apiKey.length === 0) {
      const current = await loadConfigForIp(ipHash);
      if (!current) {
        sendJson(response, 400, { error: "Enter your Anthropic API key" });
        return;
      }
      apiKey = current.apiKey;
    } else if (apiKey.length < 10 || apiKey.length > MAX_API_KEY_CHARS ||
               /[\r\n]/.test(apiKey)) {
        sendJson(response, 400, { error: "Enter a valid Anthropic API key" });
        return;
    }
    if (typeof lotSize !== "number" || !Number.isFinite(lotSize) ||
        lotSize < 0.01 || lotSize > 100) {
      sendJson(response, 400, { error: "Lot size must be between 0.01 and 100.00 lots" });
      return;
    }
    if (typeof model !== "string" ||
        !/^[A-Za-z0-9._-]{1,100}$/.test(model)) {
      sendJson(response, 400, { error: "Model name contains invalid characters" });
      return;
    }

    const result = await saveConfig(ipHash, apiKey, lotSize, model);
    if (result === "key_claimed") {
      sendJson(response, 409, {
        error: "This API key is already bound to another public IP. It cannot be shared across Wi-Fi networks.",
      });
      return;
    }
    sendJson(response, 200, {
      saved: true,
      configured: true,
      lot_size: lotSize,
      model,
    });
  } catch (error) {
    console.error(`Hosted bridge configuration failed: ${error.message}`);
    sendJson(response, 503, { error: error.message });
  }
};
