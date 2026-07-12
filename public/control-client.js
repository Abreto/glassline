const PROMPT_LIMIT_BYTES = 16 * 1024;
const CODEX_SESSION_PREFIX = "codex:session-file:";

export function followUpAvailability(session, control, activeRun) {
  const supported = Boolean(
    session?.providerId === "codex" &&
      session.id?.startsWith(CODEX_SESSION_PREFIX) &&
      session.projectPath &&
      session.resumeRef?.value
  );
  if (!supported || !control?.enabled) {
    return { supported: false, ready: false, reason: "" };
  }
  if (!control.authorized) {
    return { supported: true, ready: false, reason: "Control token required" };
  }
  if (activeRun) {
    return { supported: true, ready: false, reason: "Follow-up is running" };
  }
  if (session.turnState === "running") {
    return { supported: true, ready: false, reason: "Turn is running" };
  }
  if (session.turnState !== "idle") {
    return { supported: true, ready: false, reason: "Turn state is unknown" };
  }
  return { supported: true, ready: true, reason: "" };
}

export function validateFollowUpPrompt(prompt) {
  if (typeof prompt !== "string" || !prompt.trim()) {
    return { valid: false, error: "Enter a prompt" };
  }
  if (new TextEncoder().encode(prompt).byteLength > PROMPT_LIMIT_BYTES) {
    return { valid: false, error: "Prompt is too large" };
  }
  return { valid: true, error: "" };
}

export function controlRequestOptions(token, payload, method = "POST") {
  return {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  };
}

export function controlAuthOptions(token) {
  return token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
}

export function refreshDelay({ activeRun, turnState }) {
  return activeRun || turnState === "running" ? 1000 : 8000;
}
