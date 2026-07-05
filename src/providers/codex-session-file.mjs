import { open, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CODEX_SESSION_PREFIX = "codex:session-file:";
const SESSION_ID_PATTERN =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\.jsonl$)/i;

export function resolveCodexHome(env = process.env) {
  return env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export function extractCodexSessionReference(command) {
  const sessionIdMatch = command.match(
    /--session-id(?:=|\s+)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  if (sessionIdMatch) {
    return sessionIdMatch[1];
  }

  return command.match(SESSION_ID_PATTERN)?.[1] ?? null;
}

export async function listCodexSessionFileSessions({
  codexHome = resolveCodexHome(),
  summaryOnly = false
} = {}) {
  const indexEntries = await readSessionIndex(codexHome);
  const indexById = new Map(indexEntries.map((entry) => [entry.id, entry]));
  const files = await findSessionJsonlFiles(path.join(codexHome, "sessions"));
  const parsedById = new Map();

  await Promise.all(
    files.map(async (filePath) => {
      const fallbackId = sessionIdFromFilePath(filePath);
      const indexEntry = fallbackId ? indexById.get(fallbackId) : undefined;

      try {
        const session = summaryOnly
          ? await summarizeCodexSessionFile(filePath, { indexEntry })
          : await parseCodexSessionFile(filePath, { indexEntry });
        parsedById.set(session.id, session);
      } catch {
        if (indexEntry) {
          parsedById.set(glasslineSessionId(indexEntry.id), staleIndexSession(indexEntry, filePath));
        }
      }
    })
  );

  for (const entry of indexEntries) {
    const id = glasslineSessionId(entry.id);
    if (!parsedById.has(id)) {
      parsedById.set(id, staleIndexSession(entry));
    }
  }

  return [...parsedById.values()];
}

export async function getCodexSessionFileSession(id, { codexHome = resolveCodexHome() } = {}) {
  const sessionUuid = sessionFileUuidFromGlasslineId(id);
  if (!sessionUuid) {
    return null;
  }

  const indexEntries = await readSessionIndex(codexHome);
  const indexEntry = indexEntries.find((entry) => entry.id === sessionUuid);
  const filePath = await findSessionFileById(codexHome, sessionUuid);

  if (!filePath) {
    return indexEntry ? staleIndexSession(indexEntry) : null;
  }

  try {
    return await parseCodexSessionFile(filePath, { indexEntry });
  } catch {
    return indexEntry ? staleIndexSession(indexEntry, filePath) : null;
  }
}

export function isCodexSessionFileSessionId(id) {
  return id.startsWith(CODEX_SESSION_PREFIX);
}

export async function parseCodexSessionFile(filePath, { indexEntry } = {}) {
  const text = await readFile(filePath, "utf8");
  const fileStat = await stat(filePath);
  const fileUpdatedAt = fileStat.mtime.toISOString();
  const sourceRef = {
    kind: "session-file",
    label: "Codex JSONL",
    confidence: "medium",
    path: filePath,
    updatedAt: indexEntry?.updated_at ?? fileUpdatedAt
  };
  const timeline = [];
  const callsById = new Map();
  const seenMessages = new Set();
  let parseErrors = 0;
  let meta = {};
  let latestCreatedAt;

  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      parseErrors += 1;
      continue;
    }

    const payload = record.payload ?? {};
    const createdAt = toIsoTimestamp(record.timestamp ?? payload.timestamp) ?? fileUpdatedAt;
    latestCreatedAt = maxIso(latestCreatedAt, createdAt);

    if (record.type === "session_meta") {
      meta = {
        ...meta,
        id: payload.session_id ?? payload.id ?? meta.id,
        cwd: payload.cwd ?? meta.cwd,
        startedAt: toIsoTimestamp(payload.timestamp ?? record.timestamp) ?? meta.startedAt
      };
      continue;
    }

    if (record.type === "event_msg" && payload.type === "user_message") {
      addMessage(timeline, seenMessages, {
        id: timelineItemId(filePath, timeline.length, "message"),
        role: "user",
        content: contentToText(payload.message ?? payload.text_elements),
        createdAt,
        sourceRef
      });
      continue;
    }

    if (record.type === "event_msg" && payload.type === "agent_message") {
      addMessage(timeline, seenMessages, {
        id: timelineItemId(filePath, timeline.length, "message"),
        role: "assistant",
        content: contentToText(payload.message),
        createdAt,
        sourceRef
      });
      continue;
    }

    if (record.type === "response_item" && payload.type === "message") {
      if (payload.role === "user" || payload.role === "assistant") {
        addMessage(timeline, seenMessages, {
          id: payload.id ?? timelineItemId(filePath, timeline.length, "message"),
          role: payload.role,
          content: contentToText(payload.content),
          createdAt,
          sourceRef
        });
      }
      continue;
    }

    if (
      record.type === "response_item" &&
      (payload.type === "function_call" || payload.type === "custom_tool_call")
    ) {
      const item = callToTimelineItem(payload, createdAt, sourceRef);
      timeline.push(item);
      callsById.set(payload.call_id ?? payload.id, item);
      continue;
    }

    if (
      record.type === "response_item" &&
      (payload.type === "function_call_output" || payload.type === "custom_tool_call_output")
    ) {
      applyCallOutput(callsById.get(payload.call_id), payload.output);
      continue;
    }

    if (record.type === "event_msg" && payload.type === "patch_apply_end") {
      applyCallOutput(callsById.get(payload.call_id), payload.stdout || payload.stderr);
      for (const [changePath, change] of Object.entries(payload.changes ?? {})) {
        timeline.push({
          id: timelineItemId(filePath, timeline.length, "file"),
          type: "file_change",
          createdAt,
          path: changePath,
          summary: `${change.type ?? "change"} ${changePath}`,
          diff: change.unified_diff,
          sourceRefs: [sourceRef]
        });
      }
    }
  }

  const sessionUuid = meta.id ?? indexEntry?.id ?? sessionIdFromFilePath(filePath);
  const lastUpdatedAt = indexEntry?.updated_at ?? latestCreatedAt ?? fileUpdatedAt;

  return {
    id: glasslineSessionId(sessionUuid),
    providerId: "codex",
    providerName: "Codex",
    title: indexEntry?.thread_name ?? firstUserMessage(timeline) ?? "Codex session",
    projectPath: meta.cwd,
    status: "unknown",
    quality: "partial",
    startedAt: meta.startedAt,
    lastUpdatedAt,
    recentMessage: latestText(timeline) ?? indexEntry?.thread_name,
    sources: [sourceRef],
    timeline,
    rawAvailable: true,
    parseErrors
  };
}

async function summarizeCodexSessionFile(filePath, { indexEntry } = {}) {
  const fileStat = await stat(filePath);
  const fileUpdatedAt = fileStat.mtime.toISOString();
  const firstRecord = await readFirstJsonRecord(filePath);
  const payload = firstRecord?.type === "session_meta" ? firstRecord.payload ?? {} : {};
  const sessionUuid = payload.session_id ?? payload.id ?? indexEntry?.id ?? sessionIdFromFilePath(filePath);
  const sourceRef = {
    kind: "session-file",
    label: "Codex JSONL",
    confidence: "medium",
    path: filePath,
    updatedAt: indexEntry?.updated_at ?? fileUpdatedAt
  };

  return {
    id: glasslineSessionId(sessionUuid),
    providerId: "codex",
    providerName: "Codex",
    title: indexEntry?.thread_name ?? "Codex session",
    projectPath: payload.cwd,
    status: "unknown",
    quality: "partial",
    startedAt: toIsoTimestamp(payload.timestamp ?? firstRecord?.timestamp),
    lastUpdatedAt: indexEntry?.updated_at ?? fileUpdatedAt,
    recentMessage: indexEntry?.thread_name,
    sources: [sourceRef],
    timeline: [],
    rawAvailable: true
  };
}

export async function getRawCodexSessionFile(id, { codexHome = resolveCodexHome() } = {}) {
  const sessionUuid = sessionFileUuidFromGlasslineId(id);
  if (!sessionUuid) {
    return null;
  }

  const filePath = await findSessionFileById(codexHome, sessionUuid);
  if (!filePath) {
    return null;
  }

  return {
    text: await readFile(filePath, "utf8"),
    source: "session-file",
    confidence: "medium"
  };
}

function callToTimelineItem(payload, createdAt, sourceRef) {
  const callId = payload.call_id ?? payload.id;
  const input = parseJsonLike(payload.arguments ?? payload.input);
  const command = commandFromCall(payload.name, input);

  if (command) {
    return {
      id: callId,
      type: "command",
      createdAt,
      command: command.command,
      cwd: command.cwd,
      exitCode: null,
      output: "",
      sourceRefs: [sourceRef]
    };
  }

  return {
    id: callId,
    type: "tool_call",
    createdAt,
    name: payload.name ?? "tool",
    input,
    output: undefined,
    status: normalizeToolStatus(payload.status),
    sourceRefs: [sourceRef]
  };
}

function commandFromCall(name, input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const command = typeof input.cmd === "string" ? input.cmd : input.command;
  if (typeof command !== "string") {
    return null;
  }

  return {
    command,
    cwd: typeof input.workdir === "string" ? input.workdir : input.cwd
  };
}

function applyCallOutput(item, output) {
  if (!item) {
    return;
  }

  if (item.type === "command") {
    item.output = contentToText(output);
    item.exitCode = extractExitCode(item.output);
    return;
  }

  if (item.type === "tool_call") {
    item.output = contentToText(output);
    item.status = "complete";
  }
}

function addMessage(timeline, seenMessages, { id, role, content, createdAt, sourceRef }) {
  const text = contentToText(content);
  if (!text) {
    return;
  }

  const dedupeKey = `${role}\0${text}`;
  if (seenMessages.has(dedupeKey)) {
    return;
  }

  seenMessages.add(dedupeKey);
  timeline.push({
    id,
    type: "message",
    role,
    createdAt,
    content: text,
    sourceRefs: [sourceRef]
  });
}

async function readSessionIndex(codexHome) {
  const indexPath = path.join(codexHome, "session_index.jsonl");
  let text;

  try {
    text = await readFile(indexPath, "utf8");
  } catch {
    return [];
  }

  const entries = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = JSON.parse(line);
      if (entry.id) {
        entries.push(entry);
      }
    } catch {
      // Best-effort index parsing: a bad line should not hide every transcript.
    }
  }

  return entries;
}

async function readFirstJsonRecord(filePath) {
  const file = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(65_536);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0];
    return firstLine ? JSON.parse(firstLine) : null;
  } catch {
    return null;
  } finally {
    await file.close();
  }
}

async function findSessionJsonlFiles(root) {
  const files = [];

  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.push(entryPath);
        }
      })
    );
  }

  await visit(root);
  return files;
}

async function findSessionFileById(codexHome, sessionUuid) {
  const files = await findSessionJsonlFiles(path.join(codexHome, "sessions"));
  return files.find((filePath) => sessionIdFromFilePath(filePath) === sessionUuid) ?? null;
}

function staleIndexSession(indexEntry, filePath) {
  const sourceRef = {
    kind: "session-file",
    label: "Codex session index",
    confidence: "low",
    path: filePath,
    updatedAt: indexEntry.updated_at
  };

  return {
    id: glasslineSessionId(indexEntry.id),
    providerId: "codex",
    providerName: "Codex",
    title: indexEntry.thread_name ?? "Codex session",
    status: "unknown",
    quality: "stale",
    lastUpdatedAt: indexEntry.updated_at ?? new Date().toISOString(),
    recentMessage: indexEntry.thread_name,
    sources: [sourceRef],
    timeline: [
      {
        id: `${glasslineSessionId(indexEntry.id)}:stale`,
        type: "status",
        createdAt: indexEntry.updated_at ?? new Date().toISOString(),
        status: "unknown",
        detail: "Codex session file is missing or unreadable.",
        sourceRefs: [sourceRef]
      }
    ],
    rawAvailable: false
  };
}

function contentToText(content) {
  if (content === null || content === undefined) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        return item?.text ?? item?.content ?? "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof content === "object") {
    return JSON.stringify(content, null, 2);
  }

  return String(content);
}

function parseJsonLike(value) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractExitCode(output) {
  const match = output?.match(/Process exited with code (-?\d+)/);
  return match ? Number(match[1]) : null;
}

function normalizeToolStatus(status) {
  if (status === "completed" || status === "complete") {
    return "complete";
  }

  if (status === "failed") {
    return "failed";
  }

  if (status === "running") {
    return "running";
  }

  return "unknown";
}

function firstUserMessage(timeline) {
  return timeline.find((item) => item.type === "message" && item.role === "user")?.content;
}

function latestText(timeline) {
  const latest = [...timeline].reverse().find((item) => {
    return item.content || item.output || item.summary || item.detail;
  });

  return latest?.content ?? latest?.output ?? latest?.summary ?? latest?.detail;
}

function maxIso(left, right) {
  if (!left) {
    return right;
  }

  return Date.parse(right) > Date.parse(left) ? right : left;
}

function toIsoTimestamp(value) {
  if (!value) {
    return undefined;
  }

  const date = typeof value === "number" ? numericDate(value) : new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function numericDate(value) {
  return new Date(value < 10_000_000_000 ? value * 1000 : value);
}

function timelineItemId(filePath, index, type) {
  return `${glasslineSessionId(sessionIdFromFilePath(filePath) ?? "unknown")}:${type}:${index}`;
}

function glasslineSessionId(sessionUuid) {
  return `${CODEX_SESSION_PREFIX}${sessionUuid}`;
}

function sessionFileUuidFromGlasslineId(id) {
  return id.startsWith(CODEX_SESSION_PREFIX) ? id.slice(CODEX_SESSION_PREFIX.length) : null;
}

function sessionIdFromFilePath(filePath) {
  return path.basename(filePath).match(SESSION_ID_PATTERN)?.[1];
}
