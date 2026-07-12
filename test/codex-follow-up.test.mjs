import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createCodexFollowUpController } from "../src/control/codex-follow-up.mjs";

const SESSION_ID = "codex:session-file:11111111-1111-4111-8111-111111111111";
const SESSION_UUID = "11111111-1111-4111-8111-111111111111";

test("controller spawns codex exec resume with prompt on stdin and no shell", async () => {
  const calls = [];
  const child = fakeChild();
  const controller = createCodexFollowUpController({
    codexBin: "/opt/homebrew/bin/codex",
    env: { PATH: "/opt/homebrew/bin" },
    randomId: () => "run-one",
    now: () => new Date("2026-07-13T00:00:00.000Z"),
    spawnProcess(command, args, options) {
      calls.push({ command, args, options });
      queueMicrotask(() => child.emit("spawn"));
      return child;
    }
  });

  const run = await controller.submitFollowUp({
    sessionId: SESSION_ID,
    sessionUuid: SESSION_UUID,
    projectPath: "/repo/glassline",
    prompt: "Continue with the tests."
  });

  assert.deepEqual(calls, [
    {
      command: "/opt/homebrew/bin/codex",
      args: [
        "exec",
        "resume",
        "--json",
        "-c",
        'approval_policy="on-request"',
        "-c",
        'approvals_reviewer="auto_review"',
        SESSION_UUID,
        "-"
      ],
      options: {
        cwd: "/repo/glassline",
        env: { PATH: "/opt/homebrew/bin" },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"]
      }
    }
  ]);
  assert.equal(child.stdinText, "Continue with the tests.");
  assert.deepEqual(run, {
    id: "run-one",
    sessionId: SESSION_ID,
    status: "running",
    startedAt: "2026-07-13T00:00:00.000Z"
  });

  child.stdout.write(`${JSON.stringify({ type: "turn.completed" })}\n`);
  child.emit("close", 0);
  assert.equal(controller.getRun("run-one").status, "complete");
  assert.equal(JSON.stringify(controller.getRun("run-one")).includes("Continue with"), false);
});

test("controller rejects a second active run and releases the lock after failure", async () => {
  const first = fakeChild();
  const second = fakeChild();
  let spawnCount = 0;
  const controller = createCodexFollowUpController({
    codexBin: "/bin/codex",
    randomId: () => `run-${spawnCount + 1}`,
    spawnProcess() {
      const child = spawnCount++ === 0 ? first : second;
      queueMicrotask(() => child.emit("spawn"));
      return child;
    }
  });

  await controller.submitFollowUp(submission("first"));
  await assert.rejects(controller.submitFollowUp(submission("duplicate")), (error) => {
    assert.equal(error.code, "busy");
    return true;
  });

  first.stderr.write("private detail ".repeat(1000));
  first.stdout.write(`${JSON.stringify({ type: "turn.failed", error: { message: "denied" } })}\n`);
  first.emit("close", 1);
  const failed = controller.getRun("run-1");
  assert.equal(failed.status, "failed");
  assert.equal(failed.error.length <= 8192, true);

  const next = await controller.submitFollowUp(submission("next"));
  assert.equal(next.status, "running");
});

test("controller releases the lock when spawning fails", async () => {
  let spawnCount = 0;
  const controller = createCodexFollowUpController({
    codexBin: "/missing/codex",
    spawnProcess() {
      spawnCount += 1;
      const child = fakeChild();
      queueMicrotask(() => child.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" })));
      return child;
    }
  });

  await assert.rejects(controller.submitFollowUp(submission("one")), (error) => {
    assert.equal(error.code, "spawn-unavailable");
    return true;
  });
  await assert.rejects(controller.submitFollowUp(submission("two")), /missing/);
  assert.equal(spawnCount, 2);
});

function submission(prompt) {
  return {
    sessionId: SESSION_ID,
    sessionUuid: SESSION_UUID,
    projectPath: "/repo/glassline",
    prompt
  };
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.stdinText = "";
  child.stdin.on("data", (chunk) => {
    child.stdinText += chunk.toString("utf8");
  });
  return child;
}
