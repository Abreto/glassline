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

function normalizeSession(provider, session) {
  const now = new Date().toISOString();
  const sources = Array.isArray(session.sources) ? session.sources : [];
  const timeline = normalizeTimeline(session.timeline, sources);
  const turns = normalizeTurns(session.turns, sources);
  const lastUpdatedAt = session.lastUpdatedAt ?? session.startedAt ?? now;

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
    turns,
    timeline,
    rawAvailable: session.rawAvailable ?? false
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
