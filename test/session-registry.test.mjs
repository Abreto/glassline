import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { collectSessions, getSession, getRawSession } from "../src/core/session-registry.mjs";

test("collectSessions merges providers, sorts by last update, and preserves source quality", async () => {
  const providers = [
    {
      id: "codex",
      displayName: "Codex",
      async listSessions() {
        return [
          {
            id: "codex:alpha",
            providerId: "codex",
            providerName: "Codex",
            title: "Implement parser",
            projectPath: "/repo/a",
            status: "running",
            quality: "partial",
            startedAt: "2026-07-05T09:00:00.000Z",
            lastUpdatedAt: "2026-07-05T09:03:00.000Z",
            sources: [{ kind: "process", confidence: "high", label: "process table" }],
            timeline: []
          }
        ];
      }
    },
    {
      id: "claude-code",
      displayName: "Claude Code",
      async listSessions() {
        return [
          {
            id: "claude-code:beta",
            providerId: "claude-code",
            providerName: "Claude Code",
            title: "Fix mobile layout",
            projectPath: "/repo/b",
            status: "idle",
            quality: "complete",
            startedAt: "2026-07-05T09:01:00.000Z",
            lastUpdatedAt: "2026-07-05T09:05:00.000Z",
            sources: [{ kind: "session-file", confidence: "medium", label: "transcript jsonl" }],
            resumeRef: {
              value: "session-123",
              command: "claude -r session-123",
              label: "Claude resume id",
              confidence: "medium",
              sourceRefs: [{ kind: "session-file", confidence: "medium", label: "transcript jsonl" }]
            },
            timeline: []
          }
        ];
      }
    }
  ];

  const sessions = await collectSessions(providers);

  assert.deepEqual(
    sessions.map((session) => session.id),
    ["claude-code:beta", "codex:alpha"]
  );
  assert.equal(sessions[0].providerName, "Claude Code");
  assert.equal(sessions[0].quality, "complete");
  assert.equal(sessions[0].resumeRef.value, "session-123");
  assert.equal(sessions[0].resumeRef.command, "claude -r session-123");
  assert.equal(sessions[1].sources[0].kind, "process");
});

test("getSession returns the matching session from the owning provider", async () => {
  const providers = [
    {
      id: "mock",
      displayName: "Mock",
      async listSessions() {
        return [];
      },
      async getSession(id) {
        return id === "mock:one" ? { id, providerId: "mock", title: "One" } : null;
      }
    }
  ];

  const session = await getSession(providers, "mock:one");

  assert.equal(session.title, "One");
});

test("getRawSession returns provider raw text with source metadata", async () => {
  const providers = [
    {
      id: "mock",
      displayName: "Mock",
      async listSessions() {
        return [];
      },
      async getRawSession(id) {
        return id === "mock:one"
          ? { text: "{\"role\":\"assistant\",\"content\":\"done\"}", source: "session-file" }
          : null;
      }
    }
  ];

  const raw = await getRawSession(providers, "mock:one");

  assert.equal(raw.source, "session-file");
  assert.match(raw.text, /assistant/);
});

test("collectSessions normalizes timeline items with source refs", async () => {
  const source = { kind: "session-file", confidence: "medium", label: "transcript jsonl" };
  const providers = [
    {
      id: "mock",
      displayName: "Mock",
      async listSessions() {
        return [
          {
            id: "mock:one",
            providerId: "mock",
            title: "One",
            lastUpdatedAt: "2026-07-05T09:05:00.000Z",
            sources: [source],
            timeline: [
              {
                id: "mock:one:message",
                type: "message",
                role: "assistant",
                createdAt: "2026-07-05T09:05:00.000Z",
                content: "done"
              }
            ]
          }
        ];
      }
    }
  ];

  const [session] = await collectSessions(providers);

  assert.deepEqual(session.timeline[0].sourceRefs, [source]);
});

test("provider contract exposes the Turn model", async () => {
  const providerContract = await readFile(new URL("../src/core/provider.ts", import.meta.url), "utf8");

  assert.match(providerContract, /export interface Turn/);
  assert.match(providerContract, /export interface ResumeRef/);
  assert.match(providerContract, /resumeRef\?: ResumeRef/);
});
