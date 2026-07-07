import {
  captureOpenDisclosureIds,
  findLatestTimelineFocusBlock,
  groupTimelineItems,
  renderActivityGroup,
  renderCommandBody,
  renderMessageBody,
  restoreOpenDisclosureIds,
  shouldFocusLatestTimeline,
  textForTimelineItem,
  titleForTimelineItem
} from "./timeline-renderers.js";
import {
  renderDetailResumeRef,
  renderSessionCompactMeta,
  renderSessionResumeLine,
  textForResumeRef
} from "./session-renderers.js";
import { renderErrorState, requestJson } from "./api-client.js";

const state = {
  sessions: [],
  selectedId: null,
  renderedTimelineSessionId: null,
  view: "timeline",
  copyText: new Map()
};

const listEl = document.querySelector("#session-list");
const countEl = document.querySelector("#session-count");
const detailHeaderEl = document.querySelector("#detail-header");
const timelineEl = document.querySelector("#timeline-view");
const rawEl = document.querySelector("#raw-view");
const refreshButton = document.querySelector("#refresh-button");
const tabs = [...document.querySelectorAll(".tab")];

refreshButton.addEventListener("click", () => loadSessions({ preserveSelection: true }));

document.body.addEventListener("click", async (event) => {
  const sessionButton = event.target.closest("[data-session-id]");
  if (sessionButton) {
    await selectSession(sessionButton.dataset.sessionId);
    return;
  }

  const copyButton = event.target.closest("[data-copy-id]");
  if (copyButton) {
    await copyRegisteredText(copyButton.dataset.copyId);
  }
});

tabs.forEach((tab) => {
  tab.addEventListener("click", async () => {
    state.view = tab.dataset.view;
    renderTabs();
    if (state.view === "raw") {
      await renderRaw();
    } else {
      focusLatestTimelineMessage();
    }
  });
});

await loadSessions({ preserveSelection: false });
window.setInterval(() => loadSessions({ preserveSelection: true }), 8000);

async function loadSessions({ preserveSelection }) {
  countEl.textContent = "Refreshing";
  let payload;

  try {
    payload = await requestJson("/api/sessions", { label: "Unable to load sessions" });
  } catch (error) {
    state.sessions = [];
    state.selectedId = null;
    state.renderedTimelineSessionId = null;
    listEl.innerHTML = "";
    countEl.textContent = "Refresh failed";
    detailHeaderEl.innerHTML = '<div class="detail-heading"><h2>Unable to load sessions</h2></div>';
    timelineEl.innerHTML = renderErrorState(
      "Unable to load sessions",
      detailForError(error, "Unable to load sessions")
    );
    rawEl.innerHTML = "";
    return;
  }

  state.sessions = payload.sessions ?? [];

  if (!preserveSelection || !state.sessions.some((session) => session.id === state.selectedId)) {
    state.selectedId = state.sessions[0]?.id ?? null;
  }

  renderList();
  await renderSelectedSession({ focusLatestMessage: shouldFocusLatestTimeline({ preserveSelection }) });
}

async function selectSession(id) {
  state.selectedId = id;
  state.view = "timeline";
  renderList();
  renderTabs();
  await renderSelectedSession({ focusLatestMessage: true });
}

async function renderSelectedSession({ focusLatestMessage = false } = {}) {
  state.copyText.clear();

  if (!state.selectedId) {
    state.renderedTimelineSessionId = null;
    detailHeaderEl.innerHTML = '<div class="detail-heading"><h2>No sessions</h2></div>';
    timelineEl.innerHTML = '<p class="empty-state">No provider data available.</p>';
    countEl.textContent = "0 sessions";
    return;
  }

  let payload;

  try {
    payload = await requestJson(`/api/sessions/${encodeURIComponent(state.selectedId)}`, {
      label: "Unable to load session"
    });
  } catch (error) {
    detailHeaderEl.innerHTML = '<div class="detail-heading"><h2>Unable to load session</h2></div>';
    timelineEl.innerHTML = renderErrorState(
      "Unable to load session",
      detailForError(error, "Unable to load session")
    );
    return;
  }

  const session = payload.session;
  if (!session) {
    state.renderedTimelineSessionId = null;
    timelineEl.innerHTML = renderErrorState("Session disappeared", "The selected session is no longer available.");
    return;
  }

  renderDetailHeader(session);
  renderTimeline(session);

  if (state.view === "raw") {
    await renderRaw();
  } else if (focusLatestMessage) {
    focusLatestTimelineMessage();
  }
}

function renderList() {
  countEl.textContent = `${state.sessions.length} ${state.sessions.length === 1 ? "session" : "sessions"}`;
  listEl.innerHTML = state.sessions.map(renderSessionRow).join("");
}

function renderSessionRow(session) {
  const active = session.id === state.selectedId ? " is-active" : "";
  const recent = session.recentMessage ? `<p class="recent">${escapeHtml(session.recentMessage)}</p>` : "";

  return `
    <button class="session-row${active}" type="button" data-session-id="${escapeHtml(session.id)}">
      <div class="session-title">
        <strong>${escapeHtml(session.title)}</strong>
        ${badge(session.status, toneForStatus(session.status))}
      </div>
      <div class="badge-row">
        ${badge(session.providerName)}
        ${badge(session.quality, toneForQuality(session.quality))}
        ${session.sources.map((source) => badge(`${source.kind}:${source.confidence}`)).join("")}
      </div>
      <p class="meta-line session-meta-full">${formatTime(session.lastUpdatedAt)} · ${escapeHtml(session.projectPath ?? "Unknown path")}</p>
      ${renderSessionCompactMeta(session, formatTime(session.lastUpdatedAt))}
      ${renderSessionResumeLine(session)}
      ${recent}
    </button>
  `;
}

function renderDetailHeader(session) {
  const resumeCopyId = session.resumeRef ? registerCopyText(textForResumeRef(session)) : null;

  detailHeaderEl.innerHTML = `
    <div class="detail-heading">
      <h2>${escapeHtml(session.title)}</h2>
      <p class="meta-line detail-meta-full">${escapeHtml(session.providerName)} · ${escapeHtml(session.projectPath ?? "Unknown path")} · ${formatTime(session.lastUpdatedAt)}</p>
      <p class="meta-line detail-meta-mobile">${escapeHtml(session.providerName)} · ${formatTime(session.lastUpdatedAt)}</p>
      ${renderDetailResumeRef(session, resumeCopyId)}
      <div class="badge-row">
        ${badge(session.status, toneForStatus(session.status))}
        ${badge(session.quality, toneForQuality(session.quality))}
        ${session.sources.map((source) => badge(`${source.kind}:${source.confidence}`)).join("")}
      </div>
    </div>
  `;
}

function renderTimeline(session) {
  const shouldRestoreDisclosures = state.renderedTimelineSessionId === session.id;
  const openDisclosureIds = shouldRestoreDisclosures ? captureOpenDisclosureIds(timelineEl) : new Set();
  timelineEl.innerHTML = session.timeline.length
    ? groupTimelineItems(session.timeline).map(renderTimelineItem).join("")
    : '<p class="empty-state">No timeline items from current sources.</p>';
  if (shouldRestoreDisclosures) {
    restoreOpenDisclosureIds(timelineEl, openDisclosureIds);
  }
  state.renderedTimelineSessionId = session.id;
}

function renderTimelineItem(item) {
  const text = item.type === "activity_group" ? textForActivityGroup(item) : textForTimelineItem(item);
  const copyId = registerCopyText(text);

  return `
    <article
      class="timeline-block${item.type === "activity_group" ? " is-activity-group" : ""}"
      data-timeline-type="${escapeHtml(item.type)}"
      ${item.type === "message" ? `data-message-role="${escapeHtml(item.role)}"` : ""}
    >
      <header class="block-header">
        <div class="block-title">
          <strong>${escapeHtml(titleForTimelineItem(item))}</strong>
          <span class="block-time">${formatTime(item.createdAt)}</span>
        </div>
        <button class="icon-button" type="button" title="Copy" aria-label="Copy block" data-copy-id="${copyId}">⧉</button>
      </header>
      <div class="block-body">
        ${item.type === "activity_group" ? renderActivityGroup(item) : bodyForTimelineItem(item)}
      </div>
    </article>
  `;
}

async function renderRaw() {
  if (!state.selectedId) {
    rawEl.innerHTML = renderErrorState("Raw data unavailable", "No session is selected.");
    return;
  }

  rawEl.innerHTML = '<p class="empty-state">Loading raw data.</p>';
  let payload;

  try {
    payload = await requestJson(`/api/raw/${encodeURIComponent(state.selectedId)}`, {
      label: "Unable to load raw data"
    });
  } catch (error) {
    rawEl.innerHTML = renderErrorState(
      "Unable to load raw data",
      detailForError(error, "Unable to load raw data")
    );
    return;
  }

  if (!payload.raw) {
    rawEl.innerHTML = renderErrorState("Raw data unavailable", "The provider did not return raw source data.");
    return;
  }

  const copyId = registerCopyText(payload.raw.text);
  rawEl.innerHTML = `
    <div class="timeline-block">
      <header class="block-header">
        <div class="block-title">
          <strong>${escapeHtml(payload.raw.source)}</strong>
          <span class="block-time">${escapeHtml(payload.raw.confidence ?? "unknown")}</span>
        </div>
        <button class="icon-button" type="button" title="Copy" aria-label="Copy raw data" data-copy-id="${copyId}">⧉</button>
      </header>
      <div class="block-body">
        <pre>${escapeHtml(payload.raw.text)}</pre>
      </div>
    </div>
  `;
}

function renderTabs() {
  tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === state.view));
  timelineEl.classList.toggle("is-hidden", state.view !== "timeline");
  rawEl.classList.toggle("is-hidden", state.view !== "raw");
}

function bodyForTimelineItem(item) {
  if (item.type === "message") {
    return renderMessageBody(item);
  }

  if (item.type === "command") {
    return renderCommandBody(item);
  }

  if (item.type === "file_change") {
    return `
      <p>${escapeHtml(item.summary)}</p>
      ${item.diff ? `<pre>${escapeHtml(item.diff)}</pre>` : ""}
    `;
  }

  if (item.type === "tool_call") {
    return `<pre>${escapeHtml(JSON.stringify({ input: item.input, output: item.output }, null, 2))}</pre>`;
  }

  return `<p>${escapeHtml(textForTimelineItem(item))}</p>`;
}

function textForActivityGroup(group) {
  return group.items.map(textForTimelineItem).filter(Boolean).join("\n\n---\n\n");
}

function focusLatestTimelineMessage() {
  window.requestAnimationFrame(() => {
    const target = findLatestTimelineFocusBlock(timelineEl.querySelectorAll("[data-timeline-type]"));
    target?.scrollIntoView({ block: "center", inline: "nearest" });
  });
}

function registerCopyText(text) {
  const id = `copy-${state.copyText.size + 1}`;
  state.copyText.set(id, text ?? "");
  return id;
}

async function copyRegisteredText(id) {
  const text = state.copyText.get(id);
  if (text === undefined) {
    return;
  }

  await navigator.clipboard.writeText(text);
}

function badge(label, tone = "neutral") {
  return `<span class="badge" data-tone="${tone}">${escapeHtml(label)}</span>`;
}

function toneForStatus(status) {
  if (status === "running" || status === "complete") {
    return "good";
  }

  if (status === "failed") {
    return "bad";
  }

  return "neutral";
}

function toneForQuality(quality) {
  if (quality === "complete") {
    return "good";
  }

  if (quality === "stale" || quality === "process-only") {
    return "warn";
  }

  return "neutral";
}

function formatTime(value) {
  if (!value) {
    return "unknown time";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function detailForError(error, title) {
  const message = error instanceof Error ? error.message : String(error);
  const prefix = `${title}: `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
