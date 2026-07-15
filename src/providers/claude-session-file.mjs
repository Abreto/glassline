import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import { pageTimelineItems } from "../core/session-registry.mjs";

const CLAUDE_SESSION_PREFIX = "claude-code:session-file:";
const SESSION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_TITLE_MAX_LENGTH = 96;
const RECORD_ORDINAL = Symbol("claudeRecordOrdinal");
const SUMMARY_CONCURRENCY = 8;
const SUMMARY_TEXT_MAX_LENGTH = 4096;
const INTERNAL_USER_WRAPPER =
  /^<(?:command-[^>\s]+|local-command-[^>\s]+|task-notification|bash-input|bash-stdout)(?:\s|>)/i;

export function resolveClaudeConfigDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

export function claudeResumeRef(sessionUuid, sourceRefs = [], confidence = "medium") {
  return {
    value: sessionUuid,
    command: `claude -r ${sessionUuid}`,
    label: "Claude resume id",
    confidence,
    sourceRefs
  };
}

export function isClaudeSessionFileSessionId(id) {
  return Boolean(sessionFileUuidFromGlasslineId(id));
}

export async function listClaudeSessionFileSessions({
  claudeConfigDir = resolveClaudeConfigDir(),
  summaryOnly = false
} = {}) {
  const files = await findRootSessionJsonlFiles(claudeConfigDir);
  const sessionsById = new Map();

  const sessions = await mapWithConcurrency(
    files,
    SUMMARY_CONCURRENCY,
    async (filePath) => {
      let session;
      try {
        session = summaryOnly
          ? await summarizeClaudeSessionFile(filePath)
          : await parseClaudeSessionFile(filePath);
      } catch {
        session = await staleSessionForPath(filePath, { rawAvailable: false });
      }

      return session;
    }
  );

  for (const session of sessions) {
    if (session) {
      setNewestSession(sessionsById, session);
    }
  }

  return [...sessionsById.values()];
}

export async function parseClaudeSessionFile(filePath) {
  const parsed = await readClaudeSessionRecords(filePath);
  return buildClaudeSession(parsed, { includeTimeline: true });
}

export async function getClaudeSessionFileSession(
  id,
  { claudeConfigDir = resolveClaudeConfigDir(), sessionFilePath } = {}
) {
  const filePath = sessionFilePath ?? (await findSessionFileById(id, claudeConfigDir));
  if (!filePath) {
    return null;
  }

  try {
    const session = await parseClaudeSessionFile(filePath);
    return session?.id === id ? session : null;
  } catch {
    const session = await staleSessionForPath(filePath, { rawAvailable: false });
    return session?.id === id ? session : null;
  }
}

export async function getClaudeSessionFileTimelinePage(
  id,
  { claudeConfigDir = resolveClaudeConfigDir(), sessionFilePath, limit, cursor } = {}
) {
  const session = await getClaudeSessionFileSession(id, {
    claudeConfigDir,
    sessionFilePath
  });
  return session ? pageTimelineItems(session.timeline, { limit, cursor }) : null;
}

export async function getRawClaudeSessionFile(
  id,
  { claudeConfigDir = resolveClaudeConfigDir(), sessionFilePath } = {}
) {
  const filePath = sessionFilePath ?? (await findSessionFileById(id, claudeConfigDir));
  if (!filePath) {
    return null;
  }

  try {
    return {
      text: await readFile(filePath, "utf8"),
      source: "session-file",
      confidence: "medium"
    };
  } catch {
    return null;
  }
}

async function summarizeClaudeSessionFile(filePath) {
  const parsed = await readClaudeSessionSummary(filePath);
  return buildClaudeSession(parsed, { includeTimeline: false });
}

async function readClaudeSessionSummary(filePath) {
  const fileStat = await stat(filePath);
  const records = [];
  let parseErrors = 0;
  let lineOrdinal = 0;
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    const currentOrdinal = lineOrdinal;
    lineOrdinal += 1;
    if (!line.trim()) {
      continue;
    }

    try {
      const record = JSON.parse(line);
      if (record && typeof record === "object" && !Array.isArray(record)) {
        records.push(compactSummaryRecord(record, currentOrdinal));
      } else {
        parseErrors += 1;
      }
    } catch {
      parseErrors += 1;
    }
  }

  return {
    filePath,
    fileUpdatedAt: fileStat.mtime.toISOString(),
    records,
    parseErrors,
    rawAvailable: true
  };
}

function compactSummaryRecord(record, ordinal) {
  const compact = {
    type: record.type,
    uuid: record.uuid,
    parentUuid: record.parentUuid,
    timestamp: record.timestamp,
    cwd: record.cwd,
    sessionId: record.sessionId,
    session_id: record.session_id,
    isMeta: record.isMeta,
    subtype: record.subtype,
    leafUuid: record.leafUuid,
    agentName: summarizeText(record.agentName),
    aiTitle: summarizeText(record.aiTitle)
  };
  compact[RECORD_ORDINAL] = ordinal;

  if (record.type === "user" || record.type === "assistant") {
    compact.message = {
      id: record.message?.id,
      stop_reason: record.message?.stop_reason,
      content: compactSummaryContent(record.message?.content)
    };
  }

  return compact;
}

function compactSummaryContent(content) {
  if (typeof content === "string") {
    return summarizeText(content);
  }

  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((block) => {
    if (block?.type === "text") {
      return [{ type: "text", text: summarizeText(block.text) }];
    }
    if (block?.type === "tool_use" || block?.type === "tool_result") {
      return [{ type: block.type }];
    }
    return [];
  });
}

function summarizeText(value) {
  if (typeof value !== "string") {
    return value;
  }
  return value.length <= SUMMARY_TEXT_MAX_LENGTH
    ? value
    : `${value.slice(0, SUMMARY_TEXT_MAX_LENGTH - 1)}…`;
}

async function readClaudeSessionRecords(filePath) {
  const [text, fileStat] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
  const records = [];
  let parseErrors = 0;

  for (const [lineOrdinal, line] of text.split("\n").entries()) {
    if (!line.trim()) {
      continue;
    }

    try {
      const record = JSON.parse(line);
      if (record && typeof record === "object" && !Array.isArray(record)) {
        record[RECORD_ORDINAL] = lineOrdinal;
        records.push(record);
      } else {
        parseErrors += 1;
      }
    } catch {
      parseErrors += 1;
    }
  }

  return {
    filePath,
    fileUpdatedAt: fileStat.mtime.toISOString(),
    records,
    parseErrors,
    rawAvailable: true
  };
}

function buildClaudeSession(parsed, { includeTimeline }) {
  const { filePath, fileUpdatedAt, records, parseErrors, rawAvailable } = parsed;
  const sessionUuid = sessionUuidFromRecords(records) ?? sessionUuidFromFilePath(filePath);
  if (!sessionUuid) {
    return null;
  }

  if (records.length === 0) {
    return staleClaudeSession({
      filePath,
      fileUpdatedAt,
      sessionUuid,
      parseErrors,
      rawAvailable
    });
  }

  const activeRecords = activeConversationRecords(records);
  const timestamps = records.map((record) => toIsoTimestamp(record.timestamp)).filter(Boolean);
  const latestRecordAt = timestamps.reduce(maxIso, undefined);
  const startedAt = timestamps.reduce(minIso, undefined);
  const lastUpdatedAt = maxIso(fileUpdatedAt, latestRecordAt) ?? fileUpdatedAt;
  const sourceRef = {
    kind: "session-file",
    label: "Claude Code JSONL",
    confidence: "medium",
    path: filePath,
    updatedAt: lastUpdatedAt
  };
  const summary = summarizeConversation(activeRecords);
  const timeline = includeTimeline
    ? timelineFromRecords(activeRecords, sourceRef, fileUpdatedAt, sessionUuid)
    : [];
  const messageSummary = includeTimeline ? summarizeTimelineMessages(timeline) : summary;

  return {
    id: glasslineSessionId(sessionUuid),
    providerId: "claude-code",
    providerName: "Claude Code",
    title: claudeSessionTitle(records, summary.firstUserMessage),
    projectPath: firstString(activeRecords, "cwd") ?? firstString(records, "cwd"),
    status: "unknown",
    turnState: summary.turnState,
    quality: "partial",
    startedAt,
    lastUpdatedAt,
    recentMessage: messageSummary.recentMessage,
    sources: [sourceRef],
    resumeRef: claudeResumeRef(sessionUuid, [sourceRef]),
    timeline,
    rawAvailable: true,
    parseErrors
  };
}

function activeConversationRecords(records) {
  const leafUuid = [...records]
    .reverse()
    .find((record) => record.type === "last-prompt" && typeof record.leafUuid === "string")
    ?.leafUuid;

  if (!leafUuid) {
    return records;
  }

  const recordsByUuid = new Map(
    records
      .filter((record) => typeof record.uuid === "string" && record.uuid.length > 0)
      .map((record) => [record.uuid, record])
  );
  const active = [];
  const seen = new Set();
  let currentUuid = leafUuid;

  while (currentUuid) {
    if (seen.has(currentUuid)) {
      return records;
    }
    seen.add(currentUuid);

    const record = recordsByUuid.get(currentUuid);
    if (!record) {
      return records;
    }

    active.push(record);
    currentUuid = typeof record.parentUuid === "string" ? record.parentUuid : null;
  }

  return active.reverse();
}

function summarizeConversation(records) {
  let firstUserMessage;
  let recentMessage;
  let turnState = "unknown";

  for (const record of records) {
    turnState = nextClaudeTurnState(turnState, record);

    const messages = textMessagesFromRecord(record);
    for (const message of messages) {
      if (!firstUserMessage && message.role === "user") {
        firstUserMessage = message.content;
      }
      recentMessage = message.content;
    }
  }

  return { firstUserMessage, recentMessage, turnState };
}

function summarizeTimelineMessages(timeline) {
  const messages = timeline.filter((item) => item.type === "message");
  return {
    firstUserMessage: messages.find((message) => message.role === "user")?.content,
    recentMessage: messages.at(-1)?.content
  };
}

function timelineFromRecords(records, sourceRef, fallbackCreatedAt, sessionUuid) {
  const timeline = [];
  const callsById = new Map();

  for (const record of records) {
    const createdAt = toIsoTimestamp(record.timestamp) ?? fallbackCreatedAt;

    if (record.type === "assistant") {
      addAssistantContent(timeline, callsById, record, createdAt, sourceRef, sessionUuid);
      continue;
    }

    if (record.type === "user") {
      addUserContent(timeline, callsById, record, createdAt, sourceRef, sessionUuid);
    }
  }

  return timeline;
}

function addAssistantContent(timeline, callsById, record, createdAt, sourceRef, sessionUuid) {
  const content = record.message?.content;
  const blocks = Array.isArray(content) ? content : [{ type: "text", text: content }];

  for (const [index, block] of blocks.entries()) {
    if (!block || typeof block !== "object") {
      continue;
    }

    if (block.type === "text") {
      addMessage(timeline, {
        id: timelineItemId(record, index, "message", sessionUuid),
        role: "assistant",
        content: block.text,
        createdAt,
        sourceRef
      });
      continue;
    }

    if (block.type !== "tool_use") {
      continue;
    }

    const callId = validString(block.id) ?? timelineItemId(record, index, "tool", sessionUuid);
    const input = block.input;
    let item;

    if (block.name === "Bash" && typeof input?.command === "string") {
      item = {
        id: callId,
        type: "command",
        createdAt,
        command: input.command,
        cwd: validString(input.cwd) ?? validString(record.cwd),
        exitCode: null,
        output: "",
        sourceRefs: [sourceRef]
      };
    } else {
      item = {
        id: callId,
        type: "tool_call",
        createdAt,
        name: validString(block.name) ?? "tool",
        input,
        output: undefined,
        status: "running",
        turnState: "unknown",
        sourceRefs: [sourceRef]
      };
    }

    timeline.push(item);
    callsById.set(callId, item);
  }
}

function addUserContent(timeline, callsById, record, createdAt, sourceRef, sessionUuid) {
  const content = record.message?.content;
  const blocks = Array.isArray(content) ? content : [{ type: "text", text: content }];

  for (const [index, block] of blocks.entries()) {
    if (block?.type === "tool_result") {
      applyToolResult(callsById.get(block.tool_use_id), block, record.toolUseResult);
      continue;
    }

    if (record.isMeta === true) {
      continue;
    }

    const text = typeof block === "string" ? block : block?.type === "text" ? block.text : undefined;
    if (!isMeaningfulUserText(text)) {
      continue;
    }

    addMessage(timeline, {
      id: timelineItemId(record, index, "message", sessionUuid),
      role: "user",
      content: text,
      createdAt,
      sourceRef
    });
  }
}

function applyToolResult(item, block, structuredResult) {
  if (!item) {
    return;
  }

  const output = toolResultText(block.content, structuredResult);
  if (item.type === "command") {
    item.output = output;
    return;
  }

  if (item.type === "tool_call") {
    item.output = output;
    item.status = block.is_error === true ? "failed" : "complete";
  }
}

function textMessagesFromRecord(record) {
  if (record.type !== "user" && record.type !== "assistant") {
    return [];
  }

  if (record.type === "user" && record.isMeta === true) {
    return [];
  }

  const content = record.message?.content;
  const blocks = Array.isArray(content) ? content : [{ type: "text", text: content }];
  const messages = [];

  for (const block of blocks) {
    const text = typeof block === "string" ? block : block?.type === "text" ? block.text : undefined;
    if (record.type === "user" ? isMeaningfulUserText(text) : validString(text)) {
      messages.push({ role: record.type, content: text.trim() });
    }
  }

  return messages;
}

function nextClaudeTurnState(currentState, record) {
  if (record.type === "system" && record.subtype === "turn_duration") {
    return "idle";
  }

  if (record.type === "assistant") {
    const stopReason = record.message?.stop_reason;
    if (stopReason === "end_turn" || stopReason === "stop_sequence") {
      return "idle";
    }

    if (stopReason === "tool_use" || hasContentBlock(record, "tool_use")) {
      return "running";
    }
  }

  if (record.type === "user") {
    if (hasContentBlock(record, "tool_result")) {
      return "running";
    }

    if (textMessagesFromRecord(record).length > 0) {
      return "running";
    }
  }

  return currentState;
}

function hasContentBlock(record, type) {
  const content = record.message?.content;
  return Array.isArray(content) && content.some((block) => block?.type === type);
}

function addMessage(timeline, { id, role, content, createdAt, sourceRef }) {
  const text = validString(content)?.trim();
  if (!text) {
    return;
  }

  timeline.push({
    id,
    type: "message",
    role,
    createdAt,
    content: text,
    sourceRefs: [sourceRef]
  });
}

function toolResultText(content, structuredResult) {
  const direct = contentToText(content);
  if (direct) {
    return direct;
  }

  if (structuredResult && typeof structuredResult === "object") {
    const streams = [structuredResult.stdout, structuredResult.stderr]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join("\n");
    if (streams) {
      return streams;
    }
  }

  return "";
}

function contentToText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => (typeof item === "string" ? item : item?.type === "text" ? item.text : ""))
    .filter(Boolean)
    .join("\n");
}

function isMeaningfulUserText(value) {
  const text = validString(value)?.trim();
  return Boolean(text && !INTERNAL_USER_WRAPPER.test(text));
}

function claudeSessionTitle(records, firstUserMessage) {
  const agentName = lastStringRecordValue(records, "agent-name", "agentName");
  const aiTitle = lastStringRecordValue(records, "ai-title", "aiTitle");
  return clampTitle(agentName ?? aiTitle ?? firstUserMessage ?? "Claude Code session");
}

function lastStringRecordValue(records, recordType, key) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (records[index].type === recordType) {
      const value = validString(records[index][key])?.replace(/\s+/g, " ").trim();
      if (value) {
        return value;
      }
    }
  }
  return null;
}

function clampTitle(value) {
  const title = String(value).replace(/\s+/g, " ").trim();
  if (title.length <= SESSION_TITLE_MAX_LENGTH) {
    return title;
  }
  return `${title.slice(0, SESSION_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

async function findRootSessionJsonlFiles(claudeConfigDir) {
  const projectsRoot = path.join(claudeConfigDir, "projects");
  let projects;

  try {
    projects = await readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const groups = await Promise.all(
    projects
      .filter((entry) => entry.isDirectory())
      .map(async (project) => {
        const projectPath = path.join(projectsRoot, project.name);
        try {
          const entries = await readdir(projectPath, { withFileTypes: true });
          return entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
            .map((entry) => path.join(projectPath, entry.name));
        } catch {
          return [];
        }
      })
  );

  return groups.flat();
}

async function findSessionFileById(id, claudeConfigDir) {
  const sessionUuid = sessionFileUuidFromGlasslineId(id);
  if (!sessionUuid) {
    return null;
  }

  const sessions = await listClaudeSessionFileSessions({ claudeConfigDir, summaryOnly: true });
  return sessions.find((session) => session.id === id)?.sources?.[0]?.path ?? null;
}

async function staleSessionForPath(filePath, { rawAvailable }) {
  const sessionUuid = sessionUuidFromFilePath(filePath);
  if (!sessionUuid) {
    return null;
  }

  let fileUpdatedAt;
  try {
    fileUpdatedAt = (await stat(filePath)).mtime.toISOString();
  } catch {
    fileUpdatedAt = new Date().toISOString();
  }

  return staleClaudeSession({
    filePath,
    fileUpdatedAt,
    sessionUuid,
    parseErrors: 0,
    rawAvailable
  });
}

function staleClaudeSession({
  filePath,
  fileUpdatedAt,
  sessionUuid,
  parseErrors,
  rawAvailable
}) {
  const sourceRef = {
    kind: "session-file",
    label: "Claude Code JSONL",
    confidence: "low",
    path: filePath,
    updatedAt: fileUpdatedAt
  };
  const id = glasslineSessionId(sessionUuid);

  return {
    id,
    providerId: "claude-code",
    providerName: "Claude Code",
    title: "Claude Code session",
    status: "unknown",
    turnState: "unknown",
    quality: "stale",
    lastUpdatedAt: fileUpdatedAt,
    recentMessage: "Claude Code session file is unreadable or malformed.",
    sources: [sourceRef],
    resumeRef: claudeResumeRef(sessionUuid, [sourceRef], "low"),
    timeline: [
      {
        id: `${id}:stale`,
        type: "status",
        createdAt: fileUpdatedAt,
        status: "unknown",
        detail: "Claude Code session file is unreadable or malformed.",
        sourceRefs: [sourceRef]
      }
    ],
    rawAvailable,
    parseErrors
  };
}

function setNewestSession(sessionsById, session) {
  const existing = sessionsById.get(session.id);
  if (!existing || Date.parse(session.lastUpdatedAt) > Date.parse(existing.lastUpdatedAt)) {
    sessionsById.set(session.id, session);
  }
}

function sessionUuidFromRecords(records) {
  for (const record of records) {
    const sessionUuid = validSessionUuid(record.sessionId) ?? validSessionUuid(record.session_id);
    if (sessionUuid) {
      return sessionUuid;
    }
  }
  return null;
}

function sessionUuidFromFilePath(filePath) {
  return validSessionUuid(path.basename(filePath, ".jsonl"));
}

function sessionFileUuidFromGlasslineId(id) {
  if (typeof id !== "string" || !id.startsWith(CLAUDE_SESSION_PREFIX)) {
    return null;
  }
  return validSessionUuid(id.slice(CLAUDE_SESSION_PREFIX.length));
}

function validSessionUuid(value) {
  return typeof value === "string" && SESSION_UUID_PATTERN.test(value) ? value : null;
}

function glasslineSessionId(sessionUuid) {
  return `${CLAUDE_SESSION_PREFIX}${sessionUuid}`;
}

function timelineItemId(record, index, kind, sessionUuid) {
  const ordinal = Number.isInteger(record[RECORD_ORDINAL]) ? record[RECORD_ORDINAL] : 0;
  const fallbackId = `${validString(record.message?.id) ?? "record"}:line-${ordinal}`;
  const recordId = validString(record.uuid) ?? fallbackId;
  return `${glasslineSessionId(sessionUuid)}:${recordId}:${kind}:${index}`;
}

function firstString(records, key) {
  return records.map((record) => validString(record[key])).find(Boolean);
}

function validString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toIsoTimestamp(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.valueOf()) ? undefined : timestamp.toISOString();
}

function maxIso(left, right) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function minIso(left, right) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
