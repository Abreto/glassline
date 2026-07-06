import assert from "node:assert/strict";
import test from "node:test";

import {
  createClaudeCodeProvider,
  extractClaudeResumeReference,
  matchesClaudeCodeAgentProcess
} from "../src/providers/claude-code.mjs";
import { matchesCodexAgentProcess } from "../src/providers/codex.mjs";
import { processSession } from "../src/providers/process-utils.mjs";

test("codex matcher includes CLI sessions and excludes desktop helper processes", () => {
  assert.equal(matchesCodexAgentProcess({ command: "codex" }), true);
  assert.equal(matchesCodexAgentProcess({ command: "/opt/homebrew/bin/codex exec --json" }), true);
  assert.equal(matchesCodexAgentProcess({ command: "/opt/homebrew/bin/codex app-server --enable goals" }), false);
  assert.equal(
    matchesCodexAgentProcess({
      command:
        "/Applications/Codex.app/Contents/Frameworks/Codex Framework.framework/Helpers/Codex (Renderer).app/Contents/MacOS/Codex (Renderer)"
    }),
    false
  );
});

test("claude-code matcher includes CLI sessions and excludes daemon-only processes", () => {
  assert.equal(matchesClaudeCodeAgentProcess({ command: "claude" }), true);
  assert.equal(
    matchesClaudeCodeAgentProcess({
      command: "/Users/me/.local/share/claude/ClaudeCode.app/Contents/MacOS/claude --session-id abc"
    }),
    true
  );
  assert.equal(
    matchesClaudeCodeAgentProcess({
      command: "/Users/me/.local/bin/claude daemon run --origin transient"
    }),
    false
  );
});

test("extractClaudeResumeReference reads resume arguments and rejects missing values", () => {
  assert.equal(extractClaudeResumeReference("claude -r abc123"), "abc123");
  assert.equal(extractClaudeResumeReference("claude --resume abc123"), "abc123");
  assert.equal(extractClaudeResumeReference("claude --resume=abc123"), "abc123");
  assert.equal(extractClaudeResumeReference("claude --session-id abc123"), "abc123");
  assert.equal(extractClaudeResumeReference("claude -r --model sonnet"), null);
  assert.equal(extractClaudeResumeReference("claude --resume"), null);
});

test("claude-code provider exposes resumeRef for resumable process sessions", async () => {
  const provider = createClaudeCodeProvider({
    listAgentProcesses: async () => [
      {
        pid: 321,
        startedAt: "2026-07-05T09:00:00.000Z",
        command: "claude -r abc123"
      }
    ]
  });

  const [session] = await provider.listSessions();

  assert.equal(session.resumeRef.value, "abc123");
  assert.equal(session.resumeRef.command, "claude -r abc123");
  assert.equal(session.resumeRef.confidence, "high");
});

test("process-only sessions sort by process start time, not discovery refresh time", () => {
  const session = processSession({
    providerId: "codex",
    providerName: "Codex",
    processInfo: {
      pid: 123,
      startedAt: "2026-07-05T09:00:00.000Z",
      command: "codex"
    },
    title: "Codex process",
    cwd: "/repo",
    now: new Date("2026-07-05T10:00:00.000Z")
  });

  assert.equal(session.lastUpdatedAt, "2026-07-05T09:00:00.000Z");
  assert.equal(session.sources[0].updatedAt, "2026-07-05T10:00:00.000Z");
});
