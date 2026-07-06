import assert from "node:assert/strict";
import test from "node:test";

import {
  renderDetailResumeRef,
  renderSessionCompactMeta,
  renderSessionResumeLine,
  textForResumeRef
} from "../public/session-renderers.js";

test("renderSessionResumeLine shows a compact resume id in the session list", () => {
  const html = renderSessionResumeLine({
    resumeRef: {
      value: "019f3218-b3f0-7fc1-b6d7-141432908607",
      command: "codex resume 019f3218-b3f0-7fc1-b6d7-141432908607",
      label: "Codex resume id",
      confidence: "medium",
      sourceRefs: []
    }
  });

  assert.match(html, /class="resume-line"/);
  assert.match(html, /resume: 019f3218…/);
  assert.doesNotMatch(html, /b3f0-7fc1/);
});

test("renderDetailResumeRef shows the full resume id and copy control", () => {
  const html = renderDetailResumeRef(
    {
      resumeRef: {
        value: "019f3218-b3f0-7fc1-b6d7-141432908607",
        command: "codex resume 019f3218-b3f0-7fc1-b6d7-141432908607",
        label: "Codex resume id",
        confidence: "medium",
        sourceRefs: []
      }
    },
    "copy-1"
  );

  assert.match(html, /class="resume-ref"/);
  assert.match(html, /Codex resume id/);
  assert.match(html, /019f3218-b3f0-7fc1-b6d7-141432908607/);
  assert.match(html, /data-copy-id="copy-1"/);
});

test("textForResumeRef copies the raw provider argument only", () => {
  assert.equal(
    textForResumeRef({
      resumeRef: {
        value: "abc123",
        command: "claude -r abc123",
        label: "Claude resume id",
        confidence: "high",
        sourceRefs: []
      }
    }),
    "abc123"
  );
});

test("renderSessionCompactMeta shows only time and quality for mobile cards", () => {
  const html = renderSessionCompactMeta(
    {
      quality: "partial",
      projectPath: "/Users/abreto/Documents/Codex/project",
      resumeRef: {
        value: "019f3218-b3f0-7fc1-b6d7-141432908607",
        command: "codex resume 019f3218-b3f0-7fc1-b6d7-141432908607",
        label: "Codex resume id",
        confidence: "medium",
        sourceRefs: []
      },
      recentMessage: "long recent message"
    },
    "7月7日 00:37"
  );

  assert.match(html, /class="session-compact-meta"/);
  assert.match(html, /7月7日 00:37 · partial/);
  assert.doesNotMatch(html, /Users\/abreto/);
  assert.doesNotMatch(html, /019f3218/);
  assert.doesNotMatch(html, /long recent message/);
});

test("resume renderers omit empty placeholders when resumeRef is unavailable", () => {
  assert.equal(renderSessionResumeLine({}), "");
  assert.equal(renderDetailResumeRef({}, "copy-1"), "");
  assert.equal(textForResumeRef({}), "");
});
