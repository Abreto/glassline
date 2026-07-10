export async function collectSessions(providers) {
  const groups = await Promise.all(
    providers.map(async (provider) => {
      try {
        const sessions = await provider.listSessions();
        return sessions.map((session) => normalizeSession(provider, session));
      } catch (error) {
        return [providerErrorSession(provider, error)];
      }
    })
  );

  return groups
    .flat()
    .sort((left, right) => compareByUpdatedAt(left, right) || left.id.localeCompare(right.id));
}

export async function getSession(providers, id) {
  for (const provider of providersForSession(providers, id)) {
    if (typeof provider.getSession === "function") {
      const session = await provider.getSession(id);
      if (session) {
        return normalizeSession(provider, session);
      }
    }

    const sessions = await provider.listSessions();
    const session = sessions.find((candidate) => candidate.id === id);
    if (session) {
      return normalizeSession(provider, session);
    }
  }

  return null;
}

export async function getSessionTimelinePage(providers, id, options = {}) {
  const pageOptions = normalizeTimelinePageOptions(options);

  for (const provider of providersForSession(providers, id)) {
    if (typeof provider.getSessionTimelinePage === "function") {
      const page = await provider.getSessionTimelinePage(id, pageOptions);
      if (page) {
        return normalizeTimelinePage(page);
      }
    }

    const session = await providerSession(provider, id);
    if (session) {
      const normalized = normalizeSession(provider, session);
      return pageTimelineItems(normalized.timeline, pageOptions);
    }
  }

  return null;
}

export async function getRawSession(providers, id) {
  for (const provider of providersForSession(providers, id)) {
    if (typeof provider.getRawSession !== "function") {
      continue;
    }

    const raw = await provider.getRawSession(id);
    if (raw) {
      return {
        text: String(raw.text ?? ""),
        source: raw.source ?? "adapter",
        confidence: raw.confidence ?? "medium"
      };
    }
  }

  const session = await getSession(providers, id);
  return session
    ? {
        text: JSON.stringify(session, null, 2),
        source: "adapter",
        confidence: "low"
      }
    : null;
}

function providersForSession(providers, id) {
  const owner = providers.find((provider) => id.startsWith(`${provider.id}:`));
  return owner ? [owner] : providers;
}

async function providerSession(provider, id) {
  if (typeof provider.getSession === "function") {
    const session = await provider.getSession(id);
    if (session) {
      return session;
    }
  }

  const sessions = await provider.listSessions();
  return sessions.find((candidate) => candidate.id === id) ?? null;
}

function normalizeSession(provider, session) {
  const now = new Date().toISOString();
  const sources = Array.isArray(session.sources) ? session.sources : [];
  const timeline = normalizeTimeline(session.timeline, sources);
  const turns = normalizeTurns(session.turns, sources);
  const lastUpdatedAt = session.lastUpdatedAt ?? session.startedAt ?? now;
  const resumeRef = normalizeResumeRef(session.resumeRef, sources);

  return {
    id: session.id,
    providerId: session.providerId ?? provider.id,
    providerName: session.providerName ?? provider.displayName ?? provider.id,
    title: session.title ?? "Untitled session",
    projectPath: session.projectPath,
    status: session.status ?? "unknown",
    quality: session.quality ?? inferQuality(sources, timeline),
    startedAt: session.startedAt,
    lastUpdatedAt,
    recentMessage: session.recentMessage ?? latestText(timeline),
    sources,
    ...(resumeRef ? { resumeRef } : {}),
    turns,
    timeline,
    rawAvailable: session.rawAvailable ?? false
  };
}

function normalizeResumeRef(resumeRef, sessionSources) {
  if (!resumeRef || typeof resumeRef.value !== "string" || resumeRef.value.length === 0) {
    return undefined;
  }

  return {
    value: resumeRef.value,
    command: String(resumeRef.command ?? resumeRef.value),
    label: String(resumeRef.label ?? "Resume id"),
    confidence: resumeRef.confidence ?? "medium",
    sourceRefs:
      Array.isArray(resumeRef.sourceRefs) && resumeRef.sourceRefs.length > 0
        ? resumeRef.sourceRefs
        : sessionSources
  };
}

function normalizeTimeline(timeline, sessionSources) {
  if (!Array.isArray(timeline)) {
    return [];
  }

  return timeline.map((item) => {
    return {
      ...item,
      sourceRefs:
        Array.isArray(item.sourceRefs) && item.sourceRefs.length > 0
          ? item.sourceRefs
          : sessionSources
    };
  });
}

function normalizeTimelinePage(page) {
  return {
    items: normalizeTimeline(page.items, []),
    ...(page.nextCursor ? { nextCursor: String(page.nextCursor) } : {}),
    hasMore: Boolean(page.hasMore)
  };
}

export function pageTimelineItems(items, options = {}) {
  const timeline = Array.isArray(items) ? items : [];
  const limit = normalizeTimelinePageOptions(options).limit;
  const end = normalizeTimelineCursor(options.cursor, timeline.length);
  const start = Math.max(0, end - limit);

  return {
    items: timeline.slice(start, end),
    ...(start > 0 ? { nextCursor: String(start) } : {}),
    hasMore: start > 0
  };
}

function normalizeTimelinePageOptions(options = {}) {
  return {
    limit: normalizeTimelineLimit(options.limit),
    cursor: options.cursor === undefined || options.cursor === null ? undefined : String(options.cursor)
  };
}

function normalizeTimelineLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) {
    return 80;
  }

  return Math.min(200, Math.floor(limit));
}

function normalizeTimelineCursor(cursor, itemCount) {
  if (cursor === undefined || cursor === null || cursor === "") {
    return itemCount;
  }

  const value = Number(cursor);
  if (!Number.isFinite(value)) {
    return itemCount;
  }

  return Math.max(0, Math.min(itemCount, Math.floor(value)));
}

function normalizeTurns(turns, sessionSources) {
  if (!Array.isArray(turns)) {
    return undefined;
  }

  return turns.map((turn) => {
    return {
      ...turn,
      sourceRefs:
        Array.isArray(turn.sourceRefs) && turn.sourceRefs.length > 0
          ? turn.sourceRefs
          : sessionSources,
      messages: Array.isArray(turn.messages) ? normalizeTimeline(turn.messages, sessionSources) : [],
      items: Array.isArray(turn.items) ? normalizeTimeline(turn.items, sessionSources) : []
    };
  });
}

function inferQuality(sources, timeline) {
  if (timeline.length === 0 && sources.some((source) => source.kind === "process")) {
    return "process-only";
  }

  return timeline.length > 0 ? "partial" : "stale";
}

function latestText(timeline) {
  const latest = [...timeline].reverse().find((item) => {
    return item.content || item.output || item.summary || item.detail;
  });

  return latest?.content ?? latest?.output ?? latest?.summary ?? latest?.detail;
}

function compareByUpdatedAt(left, right) {
  return Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt);
}

function providerErrorSession(provider, error) {
  const now = new Date().toISOString();

  return {
    id: `${provider.id}:adapter-error`,
    providerId: provider.id,
    providerName: provider.displayName ?? provider.id,
    title: "Adapter unavailable",
    status: "failed",
    quality: "stale",
    lastUpdatedAt: now,
    recentMessage: error instanceof Error ? error.message : String(error),
    sources: [
      {
        kind: "app-server",
        label: "provider adapter",
        confidence: "high",
        updatedAt: now
      }
    ],
    timeline: [
      {
        id: `${provider.id}:adapter-error:status`,
        type: "status",
        createdAt: now,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
        sourceRefs: [
          {
            kind: "app-server",
            label: "provider adapter",
            confidence: "high",
            updatedAt: now
          }
        ]
      }
    ],
    rawAvailable: false
  };
}
