import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createClaudeCodeProvider } from "../src/providers/claude-code.mjs";
import {
  getClaudeSessionFileSession,
  getClaudeSessionFileTimelinePage,
  getRawClaudeSessionFile,
  listClaudeSessionFileSessions,
  parseClaudeSessionFile,
  resolveClaudeConfigDir
} from "../src/providers/claude-session-file.mjs";

const SESSION_UUID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = `claude-code:session-file:${SESSION_UUID}`;
const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/claude-config"
);
const fixtureSessionPath = path.join(
  fixtureRoot,
  `projects/-repo-glassline/${SESSION_UUID}.jsonl`
);

test("resolveClaudeConfigDir honors CLAUDE_CONFIG_DIR and defaults to ~/.claude", () => {
  assert.equal(resolveClaudeConfigDir({ CLAUDE_CONFIG_DIR: "/tmp/claude-config" }), "/tmp/claude-config");
  assert.equal(resolveClaudeConfigDir({}), path.join(os.homedir(), ".claude"));
});

test("parseClaudeSessionFile extracts the active message and tool timeline", async () => {
  const session = await parseClaudeSessionFile(fixtureSessionPath);
  const fileStat = await stat(fixtureSessionPath);
  const expectedUpdatedAt = new Date(
    Math.max(fileStat.mtimeMs, Date.parse("2026-07-05T09:00:12.000Z"))
  ).toISOString();

  assert.equal(session.id, SESSION_ID);
  assert.equal(session.title, "Fixture Claude thread");
  assert.equal(session.projectPath, "/repo/glassline");
  assert.equal(session.startedAt, "2026-07-05T09:00:00.000Z");
  assert.equal(session.lastUpdatedAt, expectedUpdatedAt);
  assert.equal(session.recentMessage, "Done.");
  assert.equal(session.status, "unknown");
  assert.equal(session.turnState, "idle");
  assert.equal(session.quality, "partial");
  assert.equal(session.parseErrors, 3);
  assert.equal(session.rawAvailable, true);
  assert.equal(session.sources[0].kind, "session-file");
  assert.equal(session.sources[0].path, fixtureSessionPath);
  assert.equal(session.resumeRef.value, SESSION_UUID);
  assert.equal(session.resumeRef.command, `claude -r ${SESSION_UUID}`);

  const messages = session.timeline.filter((item) => item.type === "message");
  assert.deepEqual(
    messages.map((message) => [message.role, message.content]),
    [
      ["user", "Inspect the Claude adapter."],
      ["assistant", "I will inspect the files."],
      ["assistant", "Done."]
    ]
  );
  assert.equal(session.timeline.some((item) => JSON.stringify(item).includes("private reasoning")), false);
  assert.equal(session.timeline.some((item) => JSON.stringify(item).includes("Abandoned branch")), false);

  const command = session.timeline.find((item) => item.type === "command");
  assert.equal(command.id, "toolu-bash");
  assert.equal(command.command, "npm test");
  assert.equal(command.output, "tests passed");
  assert.equal(command.exitCode, null);

  const tool = session.timeline.find((item) => item.type === "tool_call");
  assert.equal(tool.id, "toolu-read");
  assert.equal(tool.name, "Read");
  assert.deepEqual(tool.input, { file_path: "/repo/glassline/src/providers/claude-code.mjs" });
  assert.equal(tool.output, "permission denied");
  assert.equal(tool.status, "failed");
  assert.equal(tool.turnState, "unknown");
});

test("listClaudeSessionFileSessions returns root summaries and excludes nested subagents", async () => {
  const sessions = await listClaudeSessionFileSessions({
    claudeConfigDir: fixtureRoot,
    summaryOnly: true
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, SESSION_ID);
  assert.equal(sessions[0].title, "Fixture Claude thread");
  assert.equal(sessions[0].turnState, "idle");
  assert.deepEqual(sessions[0].timeline, []);
  assert.equal(sessions[0].rawAvailable, true);
  assert.equal(sessions[0].parseErrors, 3);
});

test("parseClaudeSessionFile falls back to valid file order when leaf metadata is invalid", async () => {
  const claudeConfigDir = await mkdtemp(path.join(os.tmpdir(), "glassline-claude-order-"));
  const sessionPath = path.join(claudeConfigDir, `${SESSION_UUID}.jsonl`);
  const records = [
    record({
      type: "user",
      uuid: "user",
      parentUuid: null,
      message: { role: "user", content: "Prompt" },
      timestamp: "2026-07-05T09:00:00.000Z"
    }),
    record({
      type: "assistant",
      uuid: "first",
      parentUuid: "user",
      message: assistantMessage("First branch", "end_turn"),
      timestamp: "2026-07-05T09:00:01.000Z"
    }),
    record({
      type: "assistant",
      uuid: "second",
      parentUuid: "user",
      message: assistantMessage("Second branch", "end_turn"),
      timestamp: "2026-07-05T09:00:02.000Z"
    }),
    JSON.stringify({ type: "last-prompt", leafUuid: "missing-leaf", sessionId: SESSION_UUID })
  ];

  await writeFile(sessionPath, records.join("\n"));
  const session = await parseClaudeSessionFile(sessionPath);

  assert.deepEqual(
    session.timeline.filter((item) => item.type === "message").map((item) => item.content),
    ["Prompt", "First branch", "Second branch"]
  );
});

test("Claude titles prefer explicit names and clamp them to 96 characters", async () => {
  const claudeConfigDir = await mkdtemp(path.join(os.tmpdir(), "glassline-claude-title-"));
  const sessionPath = path.join(claudeConfigDir, `${SESSION_UUID}.jsonl`);
  const longName = `Explicit ${"x".repeat(120)}`;
  const records = [
    JSON.stringify({ type: "ai-title", aiTitle: "Generated fallback", sessionId: SESSION_UUID }),
    JSON.stringify({ type: "agent-name", agentName: longName, sessionId: SESSION_UUID }),
    record({
      type: "user",
      uuid: "title-user",
      message: { role: "user", content: "User fallback title" },
      timestamp: "2026-07-05T09:00:00.000Z"
    })
  ];

  await writeFile(sessionPath, records.join("\n"));
  const session = await parseClaudeSessionFile(sessionPath);

  assert.equal(session.title.startsWith("Explicit "), true);
  assert.equal(session.title.endsWith("…"), true);
  assert.equal(session.title.length, 96);
});

test("fallback timeline ids stay unique and stable when uuid is missing and records append", async () => {
  const claudeConfigDir = await mkdtemp(path.join(os.tmpdir(), "glassline-claude-ids-"));
  const sessionPath = path.join(claudeConfigDir, `${SESSION_UUID}.jsonl`);
  const sharedAssistantMessage = (text) => ({
    id: "shared-message-id",
    role: "assistant",
    content: [{ type: "text", text }],
    stop_reason: "end_turn"
  });
  const initialRecords = [
    record({
      type: "user",
      message: { role: "user", content: "Prompt without uuid" },
      timestamp: "2026-07-05T09:00:00.000Z"
    }),
    record({
      type: "assistant",
      message: sharedAssistantMessage("First fragment"),
      timestamp: "2026-07-05T09:00:01.000Z"
    }),
    record({
      type: "assistant",
      message: sharedAssistantMessage("Second fragment"),
      timestamp: "2026-07-05T09:00:02.000Z"
    })
  ];

  await writeFile(sessionPath, initialRecords.join("\n"));
  const before = await parseClaudeSessionFile(sessionPath);
  const beforeIds = before.timeline.map((item) => item.id);
  assert.equal(new Set(beforeIds).size, beforeIds.length);

  await appendFile(
    sessionPath,
    `\n${record({
      type: "assistant",
      message: sharedAssistantMessage("Appended fragment"),
      timestamp: "2026-07-05T09:00:03.000Z"
    })}`
  );
  const after = await parseClaudeSessionFile(sessionPath);
  const afterIds = after.timeline.map((item) => item.id);

  assert.deepEqual(afterIds.slice(0, beforeIds.length), beforeIds);
  assert.equal(new Set(afterIds).size, afterIds.length);
});

test("listClaudeSessionFileSessions keeps stale identifiable files and the newest duplicate", async () => {
  const claudeConfigDir = await mkdtemp(path.join(os.tmpdir(), "glassline-claude-list-"));
  const projectsDir = path.join(claudeConfigDir, "projects");
  const oldPath = path.join(projectsDir, "-repo-old", `${SESSION_UUID}.jsonl`);
  const newPath = path.join(projectsDir, "-repo-new", `${SESSION_UUID}.jsonl`);
  const staleUuid = "55555555-5555-4555-8555-555555555555";
  const stalePath = path.join(projectsDir, "-repo-stale", `${staleUuid}.jsonl`);

  await Promise.all([
    mkdir(path.dirname(oldPath), { recursive: true }),
    mkdir(path.dirname(newPath), { recursive: true }),
    mkdir(path.dirname(stalePath), { recursive: true })
  ]);
  await writeFile(
    oldPath,
    [
      JSON.stringify({ type: "agent-name", agentName: "Old title", sessionId: SESSION_UUID }),
      record({ type: "user", uuid: "old", message: { role: "user", content: "Old" }, timestamp: "2026-07-05T09:00:00.000Z" })
    ].join("\n")
  );
  await writeFile(
    newPath,
    [
      JSON.stringify({ type: "agent-name", agentName: "New title", sessionId: SESSION_UUID }),
      record({ type: "user", uuid: "new", message: { role: "user", content: "New" }, timestamp: "2026-07-05T10:00:00.000Z" })
    ].join("\n")
  );
  await writeFile(stalePath, "not json\nstill not json");
  await utimes(oldPath, new Date("2026-07-05T09:00:00.000Z"), new Date("2026-07-05T09:00:00.000Z"));
  await utimes(newPath, new Date("2026-07-05T10:00:00.000Z"), new Date("2026-07-05T10:00:00.000Z"));

  const sessions = await listClaudeSessionFileSessions({ claudeConfigDir, summaryOnly: true });
  const duplicate = sessions.find((session) => session.id === SESSION_ID);
  const stale = sessions.find(
    (session) => session.id === `claude-code:session-file:${staleUuid}`
  );

  assert.equal(sessions.length, 2);
  assert.equal(duplicate.title, "New title");
  assert.equal(duplicate.sources[0].path, newPath);
  assert.equal(stale.quality, "stale");
  assert.equal(stale.rawAvailable, true);

  assert.deepEqual(
    await listClaudeSessionFileSessions({
      claudeConfigDir: path.join(claudeConfigDir, "missing"),
      summaryOnly: true
    }),
    []
  );
});

test("Claude session-file helpers return detail, newest-first pages, and exact raw JSONL", async () => {
  const session = await getClaudeSessionFileSession(SESSION_ID, { claudeConfigDir: fixtureRoot });
  assert.equal(session.timeline.length > 3, true);

  const latest = await getClaudeSessionFileTimelinePage(SESSION_ID, {
    claudeConfigDir: fixtureRoot,
    limit: 2
  });
  assert.equal(latest.items.length, 2);
  assert.equal(latest.hasMore, true);
  assert.equal(typeof latest.nextCursor, "string");

  const older = await getClaudeSessionFileTimelinePage(SESSION_ID, {
    claudeConfigDir: fixtureRoot,
    limit: 2,
    cursor: latest.nextCursor
  });
  assert.equal(older.items.length, 2);
  assert.equal(
    new Set([...older.items, ...latest.items].map((item) => item.id)).size,
    older.items.length + latest.items.length
  );

  const raw = await getRawClaudeSessionFile(SESSION_ID, { claudeConfigDir: fixtureRoot });
  assert.equal(raw.source, "session-file");
  assert.equal(raw.confidence, "medium");
  assert.equal(raw.text, await readFile(fixtureSessionPath, "utf8"));

  assert.equal(await getClaudeSessionFileSession("claude-code:process:123", { claudeConfigDir: fixtureRoot }), null);
});

test("Claude provider merges only exact process session references into file summaries", async () => {
  const provider = createClaudeCodeProvider({
    claudeConfigDir: fixtureRoot,
    listAgentProcesses: async () => [
      {
        pid: 321,
        startedAt: "2026-07-05T09:30:00.000Z",
        command: `claude --session-id ${SESSION_UUID}`
      },
      {
        pid: 654,
        startedAt: "2026-07-05T09:31:00.000Z",
        command: "claude"
      }
    ]
  });

  const sessions = await provider.listSessions();
  const linked = sessions.find((session) => session.id === SESSION_ID);

  assert.equal(sessions.some((session) => session.id === "claude-code:process:321"), false);
  assert.equal(sessions.some((session) => session.id === "claude-code:process:654"), true);
  assert.equal(linked.status, "running");
  assert.equal(linked.turnState, "idle");
  assert.deepEqual(linked.timeline, []);
  assert.equal(
    linked.sources.some((source) => source.kind === "process" && source.label === "pid 321"),
    true
  );

  const detail = await provider.getSession(SESSION_ID);
  assert.equal(detail.timeline.some((item) => item.type === "command"), true);
  assert.equal(detail.status, "running");
  assert.equal(detail.turnState, "idle");
  assert.equal(
    detail.sources.some((source) => source.kind === "process" && source.label === "pid 321"),
    true
  );

  const page = await provider.getSessionTimelinePage(SESSION_ID, { limit: 2 });
  assert.equal(page.items.length, 2);
  assert.equal(page.hasMore, true);

  const raw = await provider.getRawSession(SESSION_ID);
  assert.equal(raw.source, "session-file");
  assert.equal(raw.text, await readFile(fixtureSessionPath, "utf8"));
});

function record(overrides) {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    cwd: "/repo/glassline",
    sessionId: SESSION_UUID,
    ...overrides
  });
}

function assistantMessage(text, stopReason) {
  return {
    id: `message-${text.toLowerCase().replaceAll(" ", "-")}`,
    role: "assistant",
    content: [{ type: "text", text }],
    stop_reason: stopReason
  };
}
