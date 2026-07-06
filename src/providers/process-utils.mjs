import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function listAgentProcesses(matchers) {
  const processes = await listProcesses();
  return processes.filter((processInfo) => {
    return matchers.some((matcher) => matchesProcess(matcher, processInfo));
  });
}

function matchesProcess(matcher, processInfo) {
  if (typeof matcher === "function") {
    return matcher(processInfo);
  }

  return matcher.test(processInfo.command);
}

async function listProcesses() {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,lstart=,command="], {
    maxBuffer: 1024 * 1024
  });

  return stdout
    .split("\n")
    .map(parseProcessLine)
    .filter(Boolean);
}

function parseProcessLine(line) {
  const match = line.match(/^\s*(\d+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.+)$/);
  if (!match) {
    return null;
  }

  const [, pid, startedAtText, command] = match;
  const startedAt = new Date(startedAtText);

  return {
    pid: Number(pid),
    startedAt: Number.isNaN(startedAt.valueOf()) ? undefined : startedAt.toISOString(),
    command
  };
}

export function commandTokens(command) {
  const matches = String(command ?? "").match(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|\S+/g) ?? [];
  return matches.map((token) => {
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1);
    }

    return token;
  });
}

export function processSession({
  providerId,
  providerName,
  processInfo,
  title,
  cwd,
  resumeRef,
  now = new Date()
}) {
  const updatedAt = now.toISOString();
  const lastUpdatedAt = processInfo.startedAt ?? updatedAt;
  const sourceRef = {
    kind: "process",
    label: `pid ${processInfo.pid}`,
    confidence: "high",
    updatedAt
  };

  return {
    id: `${providerId}:process:${processInfo.pid}`,
    providerId,
    providerName,
    title,
    projectPath: cwd,
    status: "running",
    quality: "process-only",
    startedAt: processInfo.startedAt,
    lastUpdatedAt,
    recentMessage: processInfo.command,
    sources: [sourceRef],
    ...(resumeRef
      ? {
          resumeRef: {
            ...resumeRef,
            sourceRefs:
              Array.isArray(resumeRef.sourceRefs) && resumeRef.sourceRefs.length > 0
                ? resumeRef.sourceRefs
                : [sourceRef]
          }
        }
      : {}),
    timeline: [
      {
        id: `${providerId}:process:${processInfo.pid}:status`,
        type: "status",
        createdAt: updatedAt,
        status: "running",
        detail: processInfo.command,
        sourceRefs: [sourceRef]
      }
    ],
    rawAvailable: true
  };
}
