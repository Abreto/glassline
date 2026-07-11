import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createRequestHandler } from "../src/http-app.mjs";
import { parseAllowedHosts } from "../src/http-security.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(repoRoot, "public");

test("request handler rejects untrusted hosts before providers are read", async () => {
  let listCalls = 0;
  const handler = createRequestHandler({
    providers: [
      {
        id: "counted",
        displayName: "Counted",
        async listSessions() {
          listCalls += 1;
          return [];
        }
      }
    ],
    publicDir,
    allowedHosts: parseAllowedHosts()
  });
  const response = fakeResponse();

  await handler(fakeRequest("/api/sessions", { host: "attacker.example" }), response);

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { error: "Forbidden host" });
  assert.equal(listCalls, 0);
  assertSecurityHeaders(response.headers);
});

test("request handler serves APIs for explicitly allowed hosts", async () => {
  const handler = createRequestHandler({
    providers: [{ id: "mock", displayName: "Mock", async listSessions() { return []; } }],
    publicDir,
    allowedHosts: parseAllowedHosts("viewer.example.com")
  });
  const response = fakeResponse();

  await handler(fakeRequest("/api/providers", { host: "viewer.example.com:443" }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    providers: [{ id: "mock", displayName: "Mock" }]
  });
  assertSecurityHeaders(response.headers);
});

test("request handler adds security headers to error responses", async () => {
  const handler = createRequestHandler({
    providers: [],
    publicDir,
    allowedHosts: parseAllowedHosts()
  });

  for (const [request, expectedStatus] of [
    [fakeRequest("/missing", { host: "localhost:6280" }), 404],
    [fakeRequest("/api/providers", { host: "localhost:6280", method: "POST" }), 405],
    [fakeRequest("/api/sessions/%", { host: "localhost:6280" }), 500]
  ]) {
    const response = fakeResponse();
    await handler(request, response);
    assert.equal(response.statusCode, expectedStatus);
    assertSecurityHeaders(response.headers);
  }
});

function fakeRequest(url, { host, method = "GET" } = {}) {
  return { method, url, headers: { ...(host === undefined ? {} : { host }) } };
}

function fakeResponse() {
  return {
    statusCode: undefined,
    headers: {},
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body += body;
    }
  };
}

function assertSecurityHeaders(headers) {
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["Cross-Origin-Resource-Policy"], "same-origin");
  assert.match(headers["Content-Security-Policy"], /default-src 'self'/);
}
