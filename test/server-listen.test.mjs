import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { startListening } from "../src/server-listen.mjs";

test("startListening logs the local URL when the server starts", () => {
  const server = fakeServer();
  const messages = [];

  startListening(server, {
    host: "127.0.0.1",
    port: 6280,
    log: (message) => messages.push(message)
  });
  server.start();

  assert.deepEqual(messages, ["Glassline is running at http://127.0.0.1:6280"]);
});

test("startListening warns when binding beyond loopback", () => {
  const server = fakeServer();
  const warnings = [];

  startListening(server, {
    host: "0.0.0.0",
    port: 6280,
    log: () => {},
    warn: (message) => warnings.push(message)
  });
  server.start();

  assert.deepEqual(warnings, [
    "Warning: Glassline is listening on non-loopback host 0.0.0.0. Session data may contain secrets; configure GLASSLINE_ALLOWED_HOSTS and protect access with external authentication."
  ]);
});

test("startListening reports permission errors without a stack trace", () => {
  const server = fakeServer();
  const errors = [];
  let exitCode;

  startListening(server, {
    host: "127.0.0.1",
    port: 6281,
    error: (message) => errors.push(message),
    exit: (code) => {
      exitCode = code;
    }
  });
  server.emit("error", Object.assign(new Error("listen EPERM"), { code: "EPERM" }));

  assert.equal(exitCode, 1);
  assert.equal(errors[0], "Unable to start Glassline at http://127.0.0.1:6281: permission denied.");
  assert.doesNotMatch(errors[0], /at Server/);
});

test("startListening reports address-in-use errors with the configured URL", () => {
  const server = fakeServer();
  const errors = [];

  startListening(server, {
    host: "127.0.0.1",
    port: 6280,
    error: (message) => errors.push(message),
    exit: () => {}
  });
  server.emit("error", Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" }));

  assert.equal(errors[0], "Unable to start Glassline at http://127.0.0.1:6280: address already in use.");
});

function fakeServer() {
  const server = new EventEmitter();
  server.listen = (port, host, callback) => {
    server.port = port;
    server.host = host;
    server.start = callback;
  };
  return server;
}
