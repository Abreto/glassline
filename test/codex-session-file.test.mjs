import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createCodexProvider } from "../src/providers/codex.mjs";
import {
  extractCodexSessionReference,
  listCodexSessionFileSessions,
  parseCodexSessionFile
} from "../src/providers/codex-session-file.mjs";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/codex-home"
);
const fixtureSessionPath = path.join(
  fixtureRoot,
  "sessions/2026/07/05/rollout-2026-07-05T09-00-00-11111111-1111-4111-8111-111111111111.jsonl"
);

test("parseCodexSessionFile extracts metadata, messages, and skips malformed lines", async () => {
  const session = await parseCodexSessionFile(fixtureSessionPath, {
    indexEntry: {
      id: "11111111-1111-4111-8111-111111111111",
      thread_name: "Fixture Codex thread",
      updated_at: "2026-07-05T09:10:00.000Z"
    }
  });

  assert.equal(session.id, "codex:session-file:11111111-1111-4111-8111-111111111111");
  assert.equal(session.title, "Fixture Codex thread");
  assert.equal(session.projectPath, "/repo/glassline");
  assert.equal(session.startedAt, "2026-07-05T09:00:00.000Z");
  assert.equal(session.lastUpdatedAt, "2026-07-05T09:10:00.000Z");
  assert.equal(session.quality, "partial");
  assert.equal(session.sources[0].kind, "session-file");
  assert.equal(session.sources[0].confidence, "medium");
  assert.equal(session.sources[0].path, fixtureSessionPath);
  assert.equal(session.parseErrors, 1);

  const messages = session.timeline.filter((item) => item.type === "message");
  assert.deepEqual(
    messages.map((message) => [message.role, message.content]),
    [
      ["user", "Build the adapter."],
      ["assistant", "I will inspect the session files."]
    ]
  );
});

test("parseCodexSessionFile maps function calls, outputs, and patch changes", async () => {
  const session = await parseCodexSessionFile(fixtureSessionPath);

  const command = session.timeline.find((item) => item.type === "command");
  assert.equal(command.command, "npm test");
  assert.equal(command.cwd, "/repo/glassline");
  assert.equal(command.exitCode, 0);
  assert.match(command.output, /ok 1/);

  const tool = session.timeline.find((item) => item.type === "tool_call");
  assert.equal(tool.name, "apply_patch");
  assert.equal(tool.status, "complete");
  assert.equal(tool.output, "Success");

  const fileChange = session.timeline.find((item) => item.type === "file_change");
  assert.equal(fileChange.path, "src/providers/codex.mjs");
  assert.equal(fileChange.summary, "update src/providers/codex.mjs");
  assert.match(fileChange.diff, /\+new/);
});

test("listCodexSessionFileSessions returns parsed and stale index sessions", async () => {
  const sessions = await listCodexSessionFileSessions({ codexHome: fixtureRoot });
  const parsed = sessions.find(
    (session) => session.id === "codex:session-file:11111111-1111-4111-8111-111111111111"
  );
  const stale = sessions.find(
    (session) => session.id === "codex:session-file:22222222-2222-4222-8222-222222222222"
  );

  assert.equal(parsed.quality, "partial");
  assert.equal(stale.title, "Missing Codex transcript");
  assert.equal(stale.quality, "stale");
  assert.equal(stale.rawAvailable, false);
});

test("codex provider returns session-file and process sessions and resolves raw JSONL", async () => {
  const provider = createCodexProvider({
    codexHome: fixtureRoot,
    listAgentProcesses: async () => [
      {
        pid: 123,
        startedAt: "2026-07-05T09:30:00.000Z",
        command: "codex"
      }
    ]
  });

  const sessions = await provider.listSessions();

  assert.deepEqual(
    sessions.map((session) => session.id).sort(),
    [
      "codex:process:123",
      "codex:session-file:11111111-1111-4111-8111-111111111111",
      "codex:session-file:22222222-2222-4222-8222-222222222222"
    ]
  );

  const detail = await provider.getSession(
    "codex:session-file:11111111-1111-4111-8111-111111111111"
  );
  assert.equal(detail.timeline.some((item) => item.type === "message"), true);

  const raw = await provider.getRawSession(
    "codex:session-file:11111111-1111-4111-8111-111111111111"
  );
  assert.equal(raw.source, "session-file");
  assert.equal(raw.confidence, "medium");
  assert.match(raw.text, /Build the adapter/);
});

test("codex provider list uses session-file summaries and detail resolves full timeline", async () => {
  const provider = createCodexProvider({
    codexHome: fixtureRoot,
    listAgentProcesses: async () => []
  });

  const sessions = await provider.listSessions();
  const summary = sessions.find(
    (session) => session.id === "codex:session-file:11111111-1111-4111-8111-111111111111"
  );
  const detail = await provider.getSession(
    "codex:session-file:11111111-1111-4111-8111-111111111111"
  );

  assert.equal(summary.quality, "partial");
  assert.deepEqual(summary.timeline, []);
  assert.equal(summary.rawAvailable, true);
  assert.equal(detail.timeline.length > 0, true);
});

test("extractCodexSessionReference reads session ids and resume paths", () => {
  assert.equal(
    extractCodexSessionReference("codex --session-id 11111111-1111-4111-8111-111111111111"),
    "11111111-1111-4111-8111-111111111111"
  );
  assert.equal(
    extractCodexSessionReference(
      "codex --resume /tmp/rollout-2026-07-05T09-00-00-11111111-1111-4111-8111-111111111111.jsonl"
    ),
    "11111111-1111-4111-8111-111111111111"
  );
});

test("codex provider merges matching process sources into session-file sessions", async () => {
  const provider = createCodexProvider({
    codexHome: fixtureRoot,
    listAgentProcesses: async () => [
      {
        pid: 123,
        startedAt: "2026-07-05T09:30:00.000Z",
        command: "codex --session-id 11111111-1111-4111-8111-111111111111"
      },
      {
        pid: 456,
        startedAt: "2026-07-05T09:31:00.000Z",
        command: "codex"
      }
    ]
  });

  const sessions = await provider.listSessions();
  const linked = sessions.find(
    (session) => session.id === "codex:session-file:11111111-1111-4111-8111-111111111111"
  );

  assert.equal(sessions.some((session) => session.id === "codex:process:123"), false);
  assert.equal(sessions.some((session) => session.id === "codex:process:456"), true);
  assert.equal(linked.status, "running");
  assert.equal(linked.quality, "partial");
  assert.equal(linked.sources.some((source) => source.kind === "process" && source.label === "pid 123"), true);
});
