import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
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
  assert.equal(session.resumeRef.value, "11111111-1111-4111-8111-111111111111");
  assert.equal(session.resumeRef.command, "codex resume 11111111-1111-4111-8111-111111111111");
  assert.equal(session.resumeRef.confidence, "medium");
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

test("parseCodexSessionFile uses the newest JSONL event when the index is stale", async () => {
  const session = await parseCodexSessionFile(fixtureSessionPath, {
    indexEntry: {
      id: "11111111-1111-4111-8111-111111111111",
      thread_name: "Fixture Codex thread",
      updated_at: "2026-07-05T08:00:00.000Z"
    }
  });

  assert.equal(session.lastUpdatedAt, "2026-07-05T09:00:14.000Z");
  assert.equal(session.sources[0].updatedAt, "2026-07-05T09:00:14.000Z");
});

test("summary session uses file mtime when the index is stale", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "glassline-codex-home-"));
  const sessionId = "33333333-3333-4333-8333-333333333333";
  const sessionDir = path.join(codexHome, "sessions/2026/07/05");
  const sessionPath = path.join(
    sessionDir,
    `rollout-2026-07-05T09-00-00-${sessionId}.jsonl`
  );

  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    path.join(codexHome, "session_index.jsonl"),
    `${JSON.stringify({
      id: sessionId,
      thread_name: "Stale index session",
      updated_at: "2026-07-05T08:00:00.000Z"
    })}\n`
  );
  await writeFile(
    sessionPath,
    `${JSON.stringify({
      timestamp: "2026-07-05T09:00:00.000Z",
      type: "session_meta",
      payload: {
        session_id: sessionId,
        timestamp: "2026-07-05T09:00:00.000Z",
        cwd: "/repo/glassline"
      }
    })}\n`
  );
  await utimes(
    sessionPath,
    new Date("2026-07-05T09:20:00.000Z"),
    new Date("2026-07-05T09:20:00.000Z")
  );

  const sessions = await listCodexSessionFileSessions({ codexHome, summaryOnly: true });
  const session = sessions.find((candidate) => candidate.id === `codex:session-file:${sessionId}`);

  assert.equal(session.lastUpdatedAt, "2026-07-05T09:20:00.000Z");
  assert.equal(session.sources[0].updatedAt, "2026-07-05T09:20:00.000Z");
  assert.equal(session.resumeRef.value, sessionId);
});

test("summary sessions keep the newest file when rollout files share a session id", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "glassline-codex-home-"));
  const sessionId = "44444444-4444-4444-8444-444444444444";
  const sessionDir = path.join(codexHome, "sessions/2026/07/05");
  const newerPath = path.join(
    sessionDir,
    "rollout-2026-07-05T09-00-00-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl"
  );
  const olderPath = path.join(
    sessionDir,
    "rollout-2026-07-05T10-00-00-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl"
  );

  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    path.join(codexHome, "session_index.jsonl"),
    `${JSON.stringify({
      id: sessionId,
      thread_name: "Shared rollout session",
      updated_at: "2026-07-05T08:00:00.000Z"
    })}\n`
  );
  for (const filePath of [newerPath, olderPath]) {
    await writeFile(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-07-05T09:00:00.000Z",
        type: "session_meta",
        payload: {
          session_id: sessionId,
          timestamp: "2026-07-05T09:00:00.000Z",
          cwd: "/repo/glassline"
        }
      })}\n`
    );
  }
  await utimes(
    newerPath,
    new Date("2026-07-05T11:00:00.000Z"),
    new Date("2026-07-05T11:00:00.000Z")
  );
  await utimes(
    olderPath,
    new Date("2026-07-05T10:00:00.000Z"),
    new Date("2026-07-05T10:00:00.000Z")
  );

  const sessions = await listCodexSessionFileSessions({ codexHome, summaryOnly: true });
  const session = sessions.find((candidate) => candidate.id === `codex:session-file:${sessionId}`);

  assert.equal(session.lastUpdatedAt, "2026-07-05T11:00:00.000Z");
  assert.equal(session.sources[0].path, newerPath);
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
  assert.equal(summary.resumeRef.value, "11111111-1111-4111-8111-111111111111");
  assert.equal(summary.rawAvailable, true);
  assert.equal(detail.resumeRef.value, "11111111-1111-4111-8111-111111111111");
  assert.equal(detail.timeline.length > 0, true);
});

test("codex provider returns timeline pages from the newest items backward", async () => {
  const provider = createCodexProvider({
    codexHome: fixtureRoot,
    listAgentProcesses: async () => []
  });

  const latest = await provider.getSessionTimelinePage(
    "codex:session-file:11111111-1111-4111-8111-111111111111",
    { limit: 2 }
  );

  assert.deepEqual(
    latest.items.map((item) => item.type),
    ["tool_call", "file_change"]
  );
  assert.equal(latest.hasMore, true);
  assert.equal(latest.nextCursor, "3");

  const older = await provider.getSessionTimelinePage(
    "codex:session-file:11111111-1111-4111-8111-111111111111",
    { limit: 2, cursor: latest.nextCursor }
  );

  assert.deepEqual(
    older.items.map((item) => item.type),
    ["message", "command"]
  );
  assert.equal(older.hasMore, true);
  assert.equal(older.nextCursor, "1");
});

test("extractCodexSessionReference reads session ids and resume paths", () => {
  assert.equal(
    extractCodexSessionReference("codex resume 11111111-1111-4111-8111-111111111111"),
    "11111111-1111-4111-8111-111111111111"
  );
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
  assert.equal(
    extractCodexSessionReference("codex --resume 11111111-1111-4111-8111-111111111111"),
    "11111111-1111-4111-8111-111111111111"
  );
});

test("codex provider process-only session includes resumeRef from command", async () => {
  const provider = createCodexProvider({
    codexHome: fixtureRoot,
    listAgentProcesses: async () => [
      {
        pid: 789,
        startedAt: "2026-07-05T09:40:00.000Z",
        command: "codex resume 99999999-9999-4999-8999-999999999999"
      }
    ]
  });

  const sessions = await provider.listSessions();
  const processOnly = sessions.find((session) => session.id === "codex:process:789");

  assert.equal(processOnly.resumeRef.value, "99999999-9999-4999-8999-999999999999");
  assert.equal(processOnly.resumeRef.command, "codex resume 99999999-9999-4999-8999-999999999999");
  assert.equal(processOnly.resumeRef.confidence, "high");
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
