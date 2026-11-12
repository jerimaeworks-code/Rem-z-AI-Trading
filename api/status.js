"use strict";

const {
  clientIp,
  fingerprints,
  loadConfigForIp,
  getBridgeStatus,
  recordHeartbeatStatus,
  recordExecutionStatus,
} = require("../hosted_config.js");

const MAX_BODY_BYTES = 4096;
const ALLOWED_ORIGIN = "https://remzaitrading.vercel.app";
const EA_CONNECTED_WINDOW_MS = 10 * 60 * 1000;

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

function isShortText(value, maxLength) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !/[\r\n]/.test(value);
}

function publicStatus(config, status) {
  const heartbeatTime = status.eaLastSeenAt
    ? Date.parse(status.eaLastSeenAt)
    : NaN;
  return {
    configured: Boolean(config),
    bridge_address: "https://remzaitrading.vercel.app",
    model: config ? config.model : "",
    lot_size: config ? config.lotSize : null,
    request_count: config ? status.requestCount : 0,
    last_request_at: config ? status.lastRequestAt : null,
    last_signal: config ? status.lastSignal : "No signal requests yet",
    last_execution_status: config
      ? status.lastExecutionStatus
      : "No execution result reported yet",
    last_execution_at: config ? status.lastExecutionAt : null,
    last_error: config ? status.lastError : "",
    ea_connected: Boolean(config) &&
      Number.isFinite(heartbeatTime) &&
      Date.now() - heartbeatTime < EA_CONNECTED_WINDOW_MS,
    ea_last_seen_at: config ? status.eaLastSeenAt : null,
    ea_symbol: config ? status.eaSymbol : "",
    ea_timeframe: config ? status.eaTimeframe : "",
    ea_version: config ? status.eaVersion : "",
    ea_trading_enabled: Boolean(config) && status.eaTradingEnabled,
  };
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
  if (request.method !== "GET" && request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  let ipHash;
  try {
    ipHash = fingerprints(clientIp(request), "").ipHash;
  } catch (error) {
    sendJson(response, 503, { error: error.message });
    return;
  }

  try {
    if (request.method === "GET") {
      const config = await loadConfigForIp(ipHash);
      const status = await getBridgeStatus(ipHash);
      sendJson(response, 200, publicStatus(config, status));
      return;
    }

    if (!request.headers["content-type"]?.toLowerCase()
      .startsWith("application/json")) {
      sendJson(response, 415, {
        error: "Content-Type must be application/json",
      });
      return;
    }
    if (Number(request.headers["content-length"] || 0) > MAX_BODY_BYTES) {
      sendJson(response, 413, { error: "Status request is too large" });
      return;
    }

    let payload;
    try {
      payload = readPayload(request);
    } catch {
      sendJson(response, 400, { error: "Request body must be valid JSON" });
      return;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_BODY_BYTES) {
      sendJson(response, 400, { error: "Status request must be a small JSON object" });
      return;
    }

    const config = await loadConfigForIp(ipHash);
    if (!config) {
      sendJson(response, 401, {
        error: "Save bridge settings for this public IP before reporting MT5 status",
      });
      return;
    }
    if (payload.type === "heartbeat") {
      if (!isShortText(payload.symbol, 32) ||
          !isShortText(payload.timeframe, 16) ||
          (payload.version !== undefined &&
            (typeof payload.version !== "string" || payload.version.length > 16)) ||
          typeof payload.trading_enabled !== "boolean") {
        sendJson(response, 400, {
          error: "Heartbeat requires a symbol, timeframe, version, and trading_enabled flag",
        });
        return;
      }
      await recordHeartbeatStatus(ipHash, {
        symbol: payload.symbol.trim(),
        timeframe: payload.timeframe.trim(),
        version: payload.version || "",
        tradingEnabled: payload.trading_enabled,
      });
      sendJson(response, 200, { saved: true, connected: true });
      return;
    }
    if (payload.type === "execution") {
      if (!isShortText(payload.status, 300)) {
        sendJson(response, 400, {
          error: "Execution status must contain 1 to 300 characters",
        });
        return;
      }
      await recordExecutionStatus(ipHash, payload.status.trim());
      sendJson(response, 200, { saved: true });
      return;
    }

    sendJson(response, 400, { error: "Unknown bridge status update type" });
  } catch (error) {
    console.error(`Hosted bridge status request failed: ${error.message}`);
    sendJson(response, 503, {
      error: "Hosted bridge status is temporarily unavailable",
    });
  }
};
