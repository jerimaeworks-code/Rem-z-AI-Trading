"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const signalHandler = require("../api/signal.js");

const API_KEY = "sk-ant-test-key-123456789";
const ORIGIN = "https://remzaitrading.vercel.app";

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

function createRequest(overrides = {}) {
  return {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "content-length": "64",
      "x-anthropic-api-key": API_KEY,
    },
    body: {
      market_data: "M5 market data for test",
      model: "claude-sonnet-5-5",
    },
    ...overrides,
  };
}

function anthropicResponse(text) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: "text", text }] }),
  };
}

test("requires the caller's API key without exposing or storing it in the response", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("Anthropic must not be called without a key");
  };
  try {
    const response = createResponse();
    await signalHandler(createRequest({
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        "content-length": "10",
      },
    }), response);
    assert.equal(response.statusCode, 401);
    assert.match(response.json().error, /Anthropic API key/);
    assert.equal(response.body.includes(API_KEY), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("uses the supplied key only for the outbound Claude request", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return anthropicResponse("BUY 80 500 300");
  };
  try {
    const response = createResponse();
    await signalHandler(createRequest(), response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { signal: "BUY 80 500 300" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.headers["x-api-key"], API_KEY);
    assert.equal(response.body.includes(API_KEY), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("redacts the caller's API key from upstream error responses", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({
      error: { message: `Invalid API key ${API_KEY}` },
    }),
  });
  try {
    const response = createResponse();
    await signalHandler(createRequest(), response);
    assert.equal(response.statusCode, 502);
    assert.equal(response.body.includes(API_KEY), false);
    assert.match(response.json().error, /\[redacted\]/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("retries HOLD once and returns the verified signal", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return anthropicResponse(calls === 1 ? "HOLD 0 0 0" : "SELL 70 400 600");
  };
  try {
    const response = createResponse();
    await signalHandler(createRequest(), response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { signal: "SELL 70 400 600" });
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("rejects foreign browser origins before calling Claude", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("Anthropic must not be called for a rejected origin");
  };
  try {
    const response = createResponse();
    await signalHandler(createRequest({
      headers: { origin: "https://attacker.example" },
    }), response);
    assert.equal(response.statusCode, 403);
  } finally {
    global.fetch = originalFetch;
  }
});

test("returns a safe HOLD when Claude's output cannot be verified", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => anthropicResponse("Unexpected output");
  try {
    const response = createResponse();
    await signalHandler(createRequest(), response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().signal, "HOLD 0 0 0");
  } finally {
    global.fetch = originalFetch;
  }
});
