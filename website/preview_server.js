"use strict";

const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = 4173;
const ROOT = path.resolve(__dirname);
const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".zip", "application/zip"],
]);

const server = http.createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${HOST}:${PORT}`).pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(ROOT, `.${requestedPath}`);
  const relativePath = path.relative(ROOT, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES.get(path.extname(filePath).toLowerCase()) ||
        "application/octet-stream",
      "Content-Length": content.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EISDIR")
      console.error(`Website file read failed: ${error.message}`);
    response.writeHead(error.code === "ENOENT" || error.code === "EISDIR" ? 404 : 500);
    response.end(error.code === "ENOENT" || error.code === "EISDIR"
      ? "Not found" : "Internal server error");
  }
});

server.on("error", (error) => {
  console.error(`Could not start website preview: ${error.message}`);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`Rem'z AI Trading website preview: http://${HOST}:${PORT}`);
  console.log("Loopback-only preview. Press Ctrl+C to stop.");
});
