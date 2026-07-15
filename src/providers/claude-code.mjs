import { pageTimelineItems } from "../core/session-registry.mjs";
import {
  claudeResumeRef,
  getClaudeSessionFileSession,
  getClaudeSessionFileTimelinePage,
  getRawClaudeSessionFile,
  isClaudeSessionFileSessionId,
  listClaudeSessionFileSessions,
  resolveClaudeConfigDir
} from "./claude-session-file.mjs";
import { commandTokens, listAgentProcesses, processSession } from "./process-utils.mjs";

const CLAUDE_PROCESS_MATCHERS = [matchesClaudeCodeAgentProcess];

export function matchesClaudeCodeAgentProcess(processInfo) {
  const command = processInfo.command ?? "";
  const lower = command.toLowerCase();

  if (!/(^|\s|\/)(claude|claude-code)(\s|$)/i.test(command)) {
    return false;
  }

  return !lower.includes(" daemon run ");
}

export function extractClaudeResumeReference(command) {
  const tokens = commandTokens(command);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === "-r" || token === "--resume" || token === "--session-id") {
      return validResumeValue(tokens[index + 1]);
    }

    if (token.startsWith("--resume=") || token.startsWith("--session-id=")) {
      return validResumeValue(token.slice(token.indexOf("=") + 1));
    }
  }

  return null;
}

export function createClaudeCodeProvider(options = {}) {
  const claudeConfigDir = options.claudeConfigDir ?? resolveClaudeConfigDir();
  const sessionFilePaths = new Map();
  const listProcesses =
    options.listAgentProcesses ?? (() => listAgentProcesses(CLAUDE_PROCESS_MATCHERS));

  return {
    id: "claude-code",
    displayName: "Claude Code",

    async listSessions() {
      const [sessionFileSessions, processes] = await Promise.all([
        listClaudeSessionFileSessions({ claudeConfigDir, summaryOnly: true }),
        listProcesses()
      ]);
      sessionFilePaths.clear();
      for (const session of sessionFileSessions) {
        const sourcePath = session.sources.find((source) => source.kind === "session-file")?.path;
        if (sourcePath) {
          sessionFilePaths.set(session.id, sourcePath);
        }
      }
      const sessionFileById = new Map(sessionFileSessions.map((session) => [session.id, session]));
      const processSessions = [];

      for (const processInfo of processes) {
        const session = claudeProcessSession(processInfo);
        const linkedSession = session.resumeRef?.value
          ? sessionFileById.get(`claude-code:session-file:${session.resumeRef.value}`)
          : null;

        if (linkedSession) {
          mergeProcessSource(linkedSession, session);
        } else {
          processSessions.push(session);
        }
      }

      return [...sessionFileSessions, ...processSessions];
    },

    async getSession(id) {
      if (isClaudeSessionFileSessionId(id)) {
        const session = await getClaudeSessionFileSession(id, {
          claudeConfigDir,
          sessionFilePath: sessionFilePaths.get(id)
        });
        if (!session) {
          return null;
        }

        const processes = await listProcesses();
        for (const processInfo of processes) {
          const processFileSession = claudeProcessSession(processInfo);
          if (`claude-code:session-file:${processFileSession.resumeRef?.value}` === id) {
            mergeProcessSource(session, processFileSession);
          }
        }
        return session;
      }

      const sessions = await this.listSessions();
      return sessions.find((session) => session.id === id) ?? null;
    },

    async getSessionTimelinePage(id, options = {}) {
      if (isClaudeSessionFileSessionId(id)) {
        return getClaudeSessionFileTimelinePage(id, {
          ...options,
          claudeConfigDir,
          sessionFilePath: sessionFilePaths.get(id)
        });
      }

      const session = await this.getSession(id);
      return session ? pageTimelineItems(session.timeline, options) : null;
    },

    async getRawSession(id) {
      const sessionFileRaw = await getRawClaudeSessionFile(id, {
        claudeConfigDir,
        sessionFilePath: sessionFilePaths.get(id)
      });
      if (sessionFileRaw) {
        return sessionFileRaw;
      }

      const session = await this.getSession(id);
      return session
        ? {
            text: JSON.stringify(session, null, 2),
            source: "process",
            confidence: "high"
          }
        : null;
    }
  };
}

function claudeProcessSession(processInfo) {
  const resumeValue = extractClaudeResumeReference(processInfo.command ?? "");
  return processSession({
    providerId: "claude-code",
    providerName: "Claude Code",
    processInfo,
    title: "Claude Code process",
    resumeRef: resumeValue ? claudeResumeRef(resumeValue, [], "high") : undefined
  });
}

function mergeProcessSource(sessionFileSession, processFileSession) {
  sessionFileSession.status = "running";
  sessionFileSession.sources = [...sessionFileSession.sources, ...processFileSession.sources];
  sessionFileSession.recentMessage =
    sessionFileSession.recentMessage ?? processFileSession.recentMessage;
}

function validResumeValue(value) {
  return value && !value.startsWith("-") ? value : null;
}
