import { listAgentProcesses, processSession } from "./process-utils.mjs";

const CLAUDE_PROCESS_MATCHERS = [matchesClaudeCodeAgentProcess];

export function matchesClaudeCodeAgentProcess(processInfo) {
  const command = processInfo.command ?? "";
  const lower = command.toLowerCase();

  if (!/(^|\s|\/)(claude|claude-code)(\s|$)/i.test(command)) {
    return false;
  }

  return !lower.includes(" daemon run ");
}

export function createClaudeCodeProvider() {
  return {
    id: "claude-code",
    displayName: "Claude Code",

    async listSessions() {
      const processes = await listAgentProcesses(CLAUDE_PROCESS_MATCHERS);
      return processes.map((processInfo) => {
        return processSession({
          providerId: "claude-code",
          providerName: "Claude Code",
          processInfo,
          title: "Claude Code process"
        });
      });
    },

    async getSession(id) {
      const sessions = await this.listSessions();
      return sessions.find((session) => session.id === id) ?? null;
    },

    async getRawSession(id) {
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
