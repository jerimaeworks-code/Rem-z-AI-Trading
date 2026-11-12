"use strict";

const { checkStoreReady } = require("../hosted_config.js");

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    response.statusCode = 405;
    response.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  try {
    if (!(await checkStoreReady()))
      throw new Error("Hosted settings storage is unavailable");
    response.statusCode = 200;
    response.end(request.method === "HEAD"
      ? undefined
      : JSON.stringify({ status: "ready", service: "Rem'z AI Trading signal API" }));
  } catch (error) {
    console.error(`Hosted bridge health check failed: ${error.message}`);
    response.statusCode = 503;
    response.end(request.method === "HEAD"
      ? undefined
      : JSON.stringify({ status: "unavailable", error: "Hosted bridge storage is not configured" }));
  }
};
