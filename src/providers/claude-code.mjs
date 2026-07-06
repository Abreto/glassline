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
  const listProcesses =
    options.listAgentProcesses ?? (() => listAgentProcesses(CLAUDE_PROCESS_MATCHERS));

  return {
    id: "claude-code",
    displayName: "Claude Code",

    async listSessions() {
      const processes = await listProcesses();
      return processes.map((processInfo) => {
        const resumeValue = extractClaudeResumeReference(processInfo.command ?? "");
        return processSession({
          providerId: "claude-code",
          providerName: "Claude Code",
          processInfo,
          title: "Claude Code process",
          resumeRef: resumeValue
            ? {
                value: resumeValue,
                command: `claude -r ${resumeValue}`,
                label: "Claude resume id",
                confidence: "high"
              }
            : undefined
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

function validResumeValue(value) {
  return value && !value.startsWith("-") ? value : null;
}
