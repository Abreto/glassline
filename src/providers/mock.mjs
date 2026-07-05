export function createMockProvider() {
  const startedAt = "2026-07-05T09:00:00.000Z";
  const lastUpdatedAt = "2026-07-05T09:06:00.000Z";
  const sourceRef = {
    kind: "mock",
    label: "sample transcript",
    confidence: "high",
    updatedAt: lastUpdatedAt
  };

  const session = {
    id: "mock:welcome",
    providerId: "mock",
    providerName: "Mock",
    title: "Glassline MVP sample",
    projectPath: "/Users/abreto/workspace/glassline",
    status: "running",
    quality: "complete",
    startedAt,
    lastUpdatedAt,
    recentMessage: "Created a read-only viewer skeleton with provider adapters.",
    sources: [sourceRef],
    timeline: [
      {
        id: "mock:welcome:user",
        type: "message",
        role: "user",
        createdAt: "2026-07-05T09:00:10.000Z",
        content: "Build a runnable MVP skeleton for Glassline.",
        sourceRefs: [sourceRef]
      },
      {
        id: "mock:welcome:command",
        type: "command",
        createdAt: "2026-07-05T09:01:00.000Z",
        command: "npm test",
        cwd: "/Users/abreto/workspace/glassline",
        exitCode: 0,
        output: "TAP version 13\n# pass 3\n# fail 0",
        sourceRefs: [sourceRef]
      },
      {
        id: "mock:welcome:file",
        type: "file_change",
        createdAt: "2026-07-05T09:02:00.000Z",
        path: "src/core/provider.ts",
        summary: "Defined the provider adapter interface and unified session model.",
        diff: "+ export interface ProviderAdapter { ... }",
        sourceRefs: [sourceRef]
      },
      {
        id: "mock:welcome:assistant",
        type: "message",
        role: "assistant",
        createdAt: lastUpdatedAt,
        content: "Created a read-only viewer skeleton with provider adapters.",
        sourceRefs: [sourceRef]
      }
    ],
    rawAvailable: true
  };

  return {
    id: "mock",
    displayName: "Mock",

    async listSessions() {
      return [session];
    },

    async getSession(id) {
      return id === session.id ? session : null;
    },

    async getRawSession(id) {
      return id === session.id
        ? {
            text: JSON.stringify(session, null, 2),
            source: "mock",
            confidence: "high"
          }
        : null;
    }
  };
}
