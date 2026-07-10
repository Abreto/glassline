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

const TIMELINE_PAGE_LIMIT = 80;
const TIMELINE_PRELOAD_PX = 96;

const state = {
  sessions: [],
  selectedId: null,
  renderedTimelineSessionId: null,
  timelineItems: [],
  timelineNextCursor: null,
  timelineHasMore: false,
  timelineLoadingOlder: false,
  timelineHasNewer: false,
  timelineLoadingNewer: false,
  view: "timeline",
  copyText: new Map(),
  copyTextIdsByScope: new Map(),
  nextCopyTextId: 1
};

const listEl = document.querySelector("#session-list");
const countEl = document.querySelector("#session-count");
const detailHeaderEl = document.querySelector("#detail-header");
const timelineEl = document.querySelector("#timeline-view");
const rawEl = document.querySelector("#raw-view");
const refreshButton = document.querySelector("#refresh-button");
const tabs = [...document.querySelectorAll(".tab")];

refreshButton.addEventListener("click", () => loadSessions({ preserveSelection: true }));
timelineEl.addEventListener("scroll", () => handleTimelineScroll());

document.body.addEventListener("click", async (event) => {
  const sessionButton = event.target.closest("[data-session-id]");
  if (sessionButton) {
    await selectSession(sessionButton.dataset.sessionId);
    return;
  }

  const newerButton = event.target.closest("[data-load-newer]");
  if (newerButton) {
    await loadNewerTimeline();
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
    } else if (state.renderedTimelineSessionId !== state.selectedId) {
      await renderSelectedSession({ focusLatestMessage: true, reloadTimeline: true });
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
  const previousSelectedId = state.selectedId;

  try {
    payload = await requestJson("/api/sessions", { label: "Unable to load sessions" });
  } catch (error) {
    state.sessions = [];
    state.selectedId = null;
    state.renderedTimelineSessionId = null;
    resetTimelineState();
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
  const selectionChanged =
    state.selectedId !== previousSelectedId || state.renderedTimelineSessionId !== state.selectedId;
  const reloadTimeline = selectionChanged || shouldRefreshTimeline({ preserveSelection });
  const renderExistingTimeline = !reloadTimeline && markNewerTimelineIfNeeded({ preserveSelection });
  await renderSelectedSession({
    focusLatestMessage: shouldFocusLatestTimeline({ preserveSelection }),
    reloadTimeline,
    renderExistingTimeline
  });
}

async function selectSession(id) {
  state.selectedId = id;
  state.view = "timeline";
  renderList();
  renderTabs();
  await renderSelectedSession({ focusLatestMessage: true, reloadTimeline: true });
}

async function renderSelectedSession({
  focusLatestMessage = false,
  reloadTimeline = true,
  renderExistingTimeline = false
} = {}) {
  if (!state.selectedId) {
    clearCopyText();
    resetTimelineState();
    state.renderedTimelineSessionId = null;
    detailHeaderEl.innerHTML = '<div class="detail-heading"><h2>No sessions</h2></div>';
    timelineEl.innerHTML = '<p class="empty-state">No provider data available.</p>';
    countEl.textContent = "0 sessions";
    return;
  }

  const session = selectedSession();
  if (!session) {
    resetTimelineState();
    state.renderedTimelineSessionId = null;
    timelineEl.innerHTML = renderErrorState("Session disappeared", "The selected session is no longer available.");
    return;
  }

  if (reloadTimeline) {
    clearCopyText();
  }

  renderDetailHeader(session);

  if (state.view === "raw") {
    await renderRaw();
  } else if (focusLatestMessage) {
    if (reloadTimeline) {
      await loadInitialTimeline({ focusLatestMessage });
    } else {
      focusLatestTimelineMessage();
    }
  } else if (reloadTimeline) {
    await loadInitialTimeline();
  } else if (renderExistingTimeline && state.renderedTimelineSessionId === state.selectedId) {
    renderTimeline(state.selectedId);
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
  clearCopyTextScope("header");
  const resumeCopyId = session.resumeRef ? registerCopyText(textForResumeRef(session), "header") : null;

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

function renderTimeline(sessionId, { openDisclosureIds } = {}) {
  clearCopyTextScope("timeline");
  const shouldRestoreDisclosures = openDisclosureIds || state.renderedTimelineSessionId === sessionId;
  const disclosuresToRestore = openDisclosureIds ?? (shouldRestoreDisclosures ? captureOpenDisclosureIds(timelineEl) : new Set());
  const timelineHtml = state.timelineItems.length
    ? groupTimelineItems(state.timelineItems).map(renderTimelineItem).join("")
    : '<p class="empty-state">No timeline items from current sources.</p>';
  timelineEl.innerHTML = `${renderTimelinePager()}${timelineHtml}${renderNewContentControl()}`;
  if (shouldRestoreDisclosures) {
    restoreOpenDisclosureIds(timelineEl, disclosuresToRestore);
  }
  state.renderedTimelineSessionId = sessionId;
}

function renderTimelineItem(item) {
  const text = item.type === "activity_group" ? textForActivityGroup(item) : textForTimelineItem(item);
  const copyId = registerCopyText(text, "timeline");

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
  clearCopyTextScope("raw");
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

  const copyId = registerCopyText(payload.raw.text, "raw");
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

async function loadInitialTimeline({ focusLatestMessage = false } = {}) {
  const sessionId = state.selectedId;
  if (!sessionId) {
    return;
  }

  const openDisclosureIds =
    state.renderedTimelineSessionId === sessionId ? captureOpenDisclosureIds(timelineEl) : undefined;
  const preserveScrollPosition = !focusLatestMessage && state.renderedTimelineSessionId === sessionId;
  const previousScrollTop = timelineEl.scrollTop ?? 0;

  if (!preserveScrollPosition) {
    resetTimelineState();
    timelineEl.innerHTML = '<p class="empty-state">Loading timeline.</p>';
  }

  let payload;
  try {
    payload = await requestJson(timelinePageUrl(sessionId), {
      label: "Unable to load timeline"
    });
  } catch (error) {
    if (state.selectedId === sessionId) {
      timelineEl.innerHTML = renderErrorState(
        "Unable to load timeline",
        detailForError(error, "Unable to load timeline")
      );
    }
    return;
  }

  if (state.selectedId !== sessionId) {
    return;
  }

  if (preserveScrollPosition) {
    resetTimelineState();
  }
  applyTimelinePage(payload.timeline, { reset: true });
  renderTimeline(sessionId, { openDisclosureIds });

  if (focusLatestMessage) {
    focusLatestTimelineMessage();
  } else if (preserveScrollPosition) {
    timelineEl.scrollTop = previousScrollTop;
  }
}

async function handleTimelineScroll() {
  await loadOlderTimelineIfNeeded();
  await loadNewerTimelineIfNeeded();
}

async function loadOlderTimelineIfNeeded() {
  if (
    state.view !== "timeline" ||
    state.timelineLoadingOlder ||
    !state.timelineHasMore ||
    !state.timelineNextCursor ||
    (timelineEl.scrollTop ?? 0) > TIMELINE_PRELOAD_PX
  ) {
    return;
  }

  await loadOlderTimeline();
}

async function loadOlderTimeline() {
  const sessionId = state.selectedId;
  const cursor = state.timelineNextCursor;
  if (!sessionId || !cursor) {
    return;
  }

  state.timelineLoadingOlder = true;
  const openDisclosureIds = captureOpenDisclosureIds(timelineEl);
  const previousScrollHeight = timelineEl.scrollHeight ?? 0;
  const previousScrollTop = timelineEl.scrollTop ?? 0;

  try {
    const payload = await requestJson(timelinePageUrl(sessionId, cursor), {
      label: "Unable to load timeline"
    });

    if (state.selectedId !== sessionId) {
      return;
    }

    applyTimelinePage(payload.timeline, { reset: false });
    renderTimeline(sessionId, { openDisclosureIds });

    const nextScrollHeight = timelineEl.scrollHeight ?? previousScrollHeight;
    timelineEl.scrollTop = previousScrollTop + Math.max(0, nextScrollHeight - previousScrollHeight);
  } catch {
    if (state.selectedId === sessionId) {
      state.timelineHasMore = false;
      state.timelineNextCursor = null;
      renderTimeline(sessionId, { openDisclosureIds });
    }
  } finally {
    state.timelineLoadingOlder = false;
  }
}

async function loadNewerTimelineIfNeeded() {
  if (
    state.view !== "timeline" ||
    state.timelineLoadingNewer ||
    !state.timelineHasNewer ||
    !isNearTimelineEnd()
  ) {
    return;
  }

  await loadNewerTimeline();
}

function applyTimelinePage(page, { reset }) {
  const items = Array.isArray(page?.items) ? page.items : [];
  state.timelineItems = reset ? items : mergeOlderTimelineItems(items, state.timelineItems);
  state.timelineNextCursor = page?.nextCursor ?? null;
  state.timelineHasMore = Boolean(page?.hasMore && state.timelineNextCursor);
  if (reset) {
    state.timelineHasNewer = false;
    state.timelineLoadingNewer = false;
  }
}

function mergeOlderTimelineItems(olderItems, currentItems) {
  const currentIds = new Set(currentItems.map((item) => item.id));
  return [...olderItems.filter((item) => !currentIds.has(item.id)), ...currentItems];
}

async function loadNewerTimeline() {
  const sessionId = state.selectedId;
  if (!sessionId || !state.timelineHasNewer || state.timelineLoadingNewer) {
    return;
  }

  state.timelineLoadingNewer = true;
  const openDisclosureIds = captureOpenDisclosureIds(timelineEl);

  try {
    const items = await fetchNewerTimelineItems(sessionId);

    if (state.selectedId !== sessionId || !items) {
      return;
    }

    applyNewerTimelineItems(items);
    renderTimeline(sessionId, { openDisclosureIds });
    focusLatestTimelineMessage();
  } catch {
    if (state.selectedId === sessionId) {
      state.timelineLoadingNewer = false;
      renderTimeline(sessionId, { openDisclosureIds });
    }
  } finally {
    state.timelineLoadingNewer = false;
  }
}

async function fetchNewerTimelineItems(sessionId) {
  const loadedIds = new Set(state.timelineItems.map((item) => item.id));
  const seenCursors = new Set();
  let cursor;
  let items = [];

  while (true) {
    const payload = await requestJson(timelinePageUrl(sessionId, cursor), {
      label: "Unable to load timeline"
    });

    if (state.selectedId !== sessionId) {
      return null;
    }

    const page = payload.timeline;
    const pageItems = Array.isArray(page?.items) ? page.items : [];
    items = [...pageItems, ...items];

    if (pageItems.some((item) => loadedIds.has(item.id))) {
      return items;
    }

    const nextCursor = page?.hasMore ? page.nextCursor : null;
    if (!nextCursor || seenCursors.has(String(nextCursor))) {
      return null;
    }

    cursor = String(nextCursor);
    seenCursors.add(cursor);
  }
}

function applyNewerTimelineItems(items) {
  state.timelineItems = mergeNewerTimelineItems(state.timelineItems, items);
  state.timelineHasNewer = false;
}

function mergeNewerTimelineItems(currentItems, newerItems) {
  const currentIds = new Set(currentItems.map((item) => item.id));
  const newerById = new Map(newerItems.map((item) => [item.id, item]));
  return [
    ...currentItems.map((item) => newerById.get(item.id) ?? item),
    ...newerItems.filter((item) => !currentIds.has(item.id))
  ];
}

function renderTimelinePager() {
  return state.timelineHasMore ? '<div class="timeline-pager" aria-hidden="true"></div>' : "";
}

function renderNewContentControl() {
  if (!state.timelineHasNewer) {
    return "";
  }

  const label = state.timelineLoadingNewer ? "Loading new content" : "New content";
  return `<button class="timeline-newer" type="button" data-load-newer="true">${label}</button>`;
}

function resetTimelineState() {
  state.timelineItems = [];
  state.timelineNextCursor = null;
  state.timelineHasMore = false;
  state.timelineLoadingOlder = false;
  state.timelineHasNewer = false;
  state.timelineLoadingNewer = false;
  state.renderedTimelineSessionId = null;
}

function selectedSession() {
  return state.sessions.find((session) => session.id === state.selectedId) ?? null;
}

function shouldRefreshTimeline({ preserveSelection }) {
  if (!preserveSelection) {
    return true;
  }

  if (state.view === "raw") {
    return false;
  }

  if (state.timelineItems.length === 0 || state.renderedTimelineSessionId !== state.selectedId) {
    return true;
  }

  return isNearTimelineEnd();
}

function markNewerTimelineIfNeeded({ preserveSelection }) {
  if (
    !preserveSelection ||
    state.view !== "timeline" ||
    state.renderedTimelineSessionId !== state.selectedId ||
    state.timelineItems.length === 0 ||
    isNearTimelineEnd()
  ) {
    return false;
  }

  if (state.timelineHasNewer) {
    return true;
  }

  const session = selectedSession();
  const latestLoadedItem = state.timelineItems.at(-1);
  if (isAfterTimestamp(session?.lastUpdatedAt, latestLoadedItem?.createdAt)) {
    state.timelineHasNewer = true;
    return true;
  }

  return false;
}

function isNearTimelineEnd() {
  const maxScrollTop = Math.max(0, (timelineEl.scrollHeight ?? 0) - (timelineEl.clientHeight ?? 0));
  return maxScrollTop - (timelineEl.scrollTop ?? 0) < 120;
}

function isAfterTimestamp(left, right) {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs > rightMs;
}

function timelinePageUrl(sessionId, cursor) {
  const params = new URLSearchParams({ limit: String(TIMELINE_PAGE_LIMIT) });
  if (cursor) {
    params.set("cursor", cursor);
  }

  return `/api/sessions/${encodeURIComponent(sessionId)}/timeline?${params}`;
}

function focusLatestTimelineMessage() {
  window.requestAnimationFrame(() => {
    const target = findLatestTimelineFocusBlock(timelineEl.querySelectorAll("[data-timeline-type]"));
    target?.scrollIntoView({ block: "center", inline: "nearest" });
  });
}

function registerCopyText(text, scope) {
  const id = `copy-${state.nextCopyTextId}`;
  state.nextCopyTextId += 1;
  state.copyText.set(id, text ?? "");
  const scopeIds = state.copyTextIdsByScope.get(scope) ?? new Set();
  scopeIds.add(id);
  state.copyTextIdsByScope.set(scope, scopeIds);
  return id;
}

function clearCopyTextScope(scope) {
  for (const id of state.copyTextIdsByScope.get(scope) ?? []) {
    state.copyText.delete(id);
  }
  state.copyTextIdsByScope.delete(scope);
}

function clearCopyText() {
  state.copyText.clear();
  state.copyTextIdsByScope.clear();
  state.nextCopyTextId = 1;
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
