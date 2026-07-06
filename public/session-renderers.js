export function renderSessionResumeLine(session) {
  const value = textForResumeRef(session);
  if (!value) {
    return "";
  }

  return `<p class="resume-line">resume: ${escapeHtml(shortResumeValue(value))}</p>`;
}

export function renderDetailResumeRef(session, copyId) {
  const value = textForResumeRef(session);
  if (!value) {
    return "";
  }

  const label = session.resumeRef?.label ?? "Resume id";
  const copyButton = copyId
    ? `<button class="icon-button resume-copy" type="button" title="Copy resume id" aria-label="Copy resume id" data-copy-id="${escapeHtml(copyId)}">⧉</button>`
    : "";

  return `
    <div class="resume-ref">
      <span>${escapeHtml(label)}</span>
      <code>${escapeHtml(value)}</code>
      ${copyButton}
    </div>
  `;
}

export function textForResumeRef(session) {
  return session?.resumeRef?.value ?? "";
}

function shortResumeValue(value) {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
