import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedRequestHost,
  parseAllowedHosts,
  securityHeaders
} from "../src/http-security.mjs";

test("parseAllowedHosts includes loopback defaults and normalizes configured hosts", () => {
  const allowedHosts = parseAllowedHosts("Viewer.Example.COM., 192.0.2.10");

  assert.deepEqual([...allowedHosts], [
    "localhost",
    "127.0.0.1",
    "::1",
    "viewer.example.com",
    "192.0.2.10"
  ]);
});

test("parseAllowedHosts rejects schemes, ports, paths, userinfo, and wildcards", () => {
  for (const value of [
    "https://viewer.example.com",
    "viewer.example.com:6280",
    "viewer.example.com/path",
    "user@viewer.example.com",
    "*.example.com"
  ]) {
    assert.throws(
      () => parseAllowedHosts(value),
      new RegExp(`Invalid GLASSLINE_ALLOWED_HOSTS entry: ${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
    );
  }
});

test("isAllowedRequestHost accepts loopback and configured hosts with request ports", () => {
  const allowedHosts = parseAllowedHosts("viewer.example.com");

  for (const host of [
    "localhost:6280",
    "LOCALHOST.:6280",
    "127.0.0.1:6280",
    "[::1]:6280",
    "VIEWER.EXAMPLE.COM:443"
  ]) {
    assert.equal(isAllowedRequestHost(host, allowedHosts), true, host);
  }
});

test("isAllowedRequestHost rejects missing, malformed, and lookalike hosts", () => {
  const allowedHosts = parseAllowedHosts("viewer.example.com");

  for (const host of [
    undefined,
    "",
    "viewer.example.com.evil.test",
    "user@viewer.example.com",
    "https://viewer.example.com",
    "viewer.example.com/path",
    "viewer.example.com\\evil",
    "viewer.example.com port"
  ]) {
    assert.equal(isAllowedRequestHost(host, allowedHosts), false, String(host));
  }
});

test("securityHeaders returns the fixed browser security policy", () => {
  const headers = securityHeaders();

  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["Cross-Origin-Resource-Policy"], "same-origin");
  assert.match(headers["Content-Security-Policy"], /default-src 'self'/);
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(headers["Content-Security-Policy"], /object-src 'none'/);
});
