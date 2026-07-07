import { listAgentProcesses, processSession } from "./process-utils.mjs";
import {
  codexResumeRef,
  extractCodexSessionReference,
  getCodexSessionFileSession,
  getRawCodexSessionFile,
  isCodexSessionFileSessionId,
  listCodexSessionFileSessions,
  resolveCodexHome
} from "./codex-session-file.mjs";

const CODEX_PROCESS_MATCHERS = [matchesCodexAgentProcess];

export function matchesCodexAgentProcess(processInfo) {
  const command = processInfo.command ?? "";
  const lower = command.toLowerCase();

  if (!/(^|\s|\/)(codex|codex-cli)(\s|$)/i.test(command)) {
    return false;
  }

  return ![
    "app-server",
    "codex.app",
    "crashpad",
    "(renderer)",
    "(service)",
    "codex computer use",
    "skycomputeruseclient",
    "skycomputeruseservice",
    "openai.chatgpt"
  ].some((fragment) => lower.includes(fragment));
}

export function createCodexProvider(options = {}) {
  const codexHome = options.codexHome ?? resolveCodexHome();
  const listProcesses =
    options.listAgentProcesses ?? (() => listAgentProcesses(CODEX_PROCESS_MATCHERS));

  return {
    id: "codex",
    displayName: "Codex",

    async listSessions() {
      const [sessionFileSessions, processes] = await Promise.all([
        listCodexSessionFileSessions({ codexHome, summaryOnly: true }),
        listProcesses()
      ]);
      const sessionFileById = new Map(sessionFileSessions.map((session) => [session.id, session]));
      const processSessions = [];

      for (const processInfo of processes) {
        const sessionRef = extractCodexSessionReference(processInfo.command ?? "");
        const session = processSession({
          providerId: "codex",
          providerName: "Codex",
          processInfo,
          title: "Codex process",
          resumeRef: sessionRef ? codexResumeRef(sessionRef, [], "high") : undefined
        });
        const linkedSession = sessionRef
          ? sessionFileById.get(`codex:session-file:${sessionRef}`)
          : null;

        if (linkedSession) {
          linkedSession.status = "running";
          linkedSession.sources = [...linkedSession.sources, ...session.sources];
          linkedSession.recentMessage = linkedSession.recentMessage ?? session.recentMessage;
        } else {
          processSessions.push(session);
        }
      }

      return [...sessionFileSessions, ...processSessions];
    },

    async getSession(id) {
      if (isCodexSessionFileSessionId(id)) {
        return getCodexSessionFileSession(id, { codexHome });
      }

      const sessions = await this.listSessions();
      return sessions.find((session) => session.id === id) ?? null;
    },

    async getRawSession(id) {
      const sessionFileRaw = await getRawCodexSessionFile(id, { codexHome });
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
