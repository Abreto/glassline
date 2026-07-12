import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  controlRequestOptions,
  followUpAvailability,
  refreshDelay,
  validateFollowUpPrompt
} from "../public/control-client.js";

const indexHtml = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("follow-up availability requires enabled authorized idle Codex session-file data", () => {
  const ready = session();
  assert.deepEqual(
    followUpAvailability(ready, { enabled: true, authorized: true }, false),
    { supported: true, ready: true, reason: "" }
  );
  assert.equal(followUpAvailability({ ...ready, turnState: "running" }, { enabled: true, authorized: true }, false).reason, "Turn is running");
  assert.equal(followUpAvailability({ ...ready, turnState: "unknown" }, { enabled: true, authorized: true }, false).reason, "Turn state is unknown");
  assert.equal(followUpAvailability({ ...ready, providerId: "claude-code" }, { enabled: true, authorized: true }, false).supported, false);
  assert.equal(followUpAvailability(ready, { enabled: true, authorized: false }, false).reason, "Control token required");
  assert.equal(followUpAvailability(ready, { enabled: true, authorized: true }, true).reason, "Follow-up is running");
});

test("prompt validation uses a 16 KiB UTF-8 limit", () => {
  assert.deepEqual(validateFollowUpPrompt("  "), { valid: false, error: "Enter a prompt" });
  assert.deepEqual(validateFollowUpPrompt("continue"), { valid: true, error: "" });
  assert.equal(validateFollowUpPrompt("界".repeat(6000)).error, "Prompt is too large");
});

test("control requests use Bearer auth and JSON without putting prompt in the URL", () => {
  const options = controlRequestOptions("secret-token", { prompt: "continue" });
  assert.equal(options.method, "POST");
  assert.equal(options.headers.Authorization, "Bearer secret-token");
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.equal(options.body, JSON.stringify({ prompt: "continue" }));
});

test("active or externally running turns use one-second refresh", () => {
  assert.equal(refreshDelay({ activeRun: true, turnState: "idle" }), 1000);
  assert.equal(refreshDelay({ activeRun: false, turnState: "running" }), 1000);
  assert.equal(refreshDelay({ activeRun: false, turnState: "idle" }), 8000);
});

test("frontend includes composer, token dialog, and adaptive scheduling", () => {
  assert.match(indexHtml, /id="control-panel"/);
  assert.match(indexHtml, /id="follow-up-input"/);
  assert.match(indexHtml, /id="control-token-dialog"/);
  assert.match(appSource, /sessionStorage/);
  assert.match(appSource, /setTimeout/);
  assert.doesNotMatch(appSource, /setInterval\([^)]*8000/);
});

function session() {
  return {
    id: "codex:session-file:11111111-1111-4111-8111-111111111111",
    providerId: "codex",
    projectPath: "/repo/glassline",
    turnState: "idle",
    resumeRef: { value: "11111111-1111-4111-8111-111111111111" }
  };
}
