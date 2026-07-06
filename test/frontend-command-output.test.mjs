import assert from "node:assert/strict";
import test from "node:test";

import {
  findLatestTimelineFocusBlock,
  groupTimelineItems,
  renderActivityGroup,
  renderCommandBody,
  renderMessageBody,
  textForTimelineItem,
  shouldFocusLatestTimeline
} from "../public/timeline-renderers.js";

test("command output is collapsed by default but keeps full output available", () => {
  const html = renderCommandBody({
    command: "npm test",
    output: "line 1\nline 2\nline 3"
  });

  assert.match(html, /<pre class="command-text">npm test<\/pre>/);
  assert.match(html, /<details class="command-output">/);
  assert.match(html, /<summary>Show output \(3 lines\)<\/summary>/);
  assert.match(html, /line 1\nline 2\nline 3/);
  assert.doesNotMatch(html, /<details class="command-output" open>/);
});

test("renderMessageBody renders a safe markdown subset", () => {
  const html = renderMessageBody({
    type: "message",
    role: "assistant",
    content: [
      "# Findings",
      "",
      "Use **bold**, *italic*, `inline code`, and [docs](https://example.com).",
      "",
      "- first item",
      "- second item",
      "",
      "> quoted note",
      "",
      "```js",
      "const value = \"<tag>\";",
      "```"
    ].join("\n")
  });

  assert.match(html, /<div class="message-markdown">/);
  assert.match(html, /<h3>Findings<\/h3>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<code>inline code<\/code>/);
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noreferrer">docs<\/a>/);
  assert.match(html, /<ul><li>first item<\/li><li>second item<\/li><\/ul>/);
  assert.match(html, /<blockquote><p>quoted note<\/p><\/blockquote>/);
  assert.match(html, /<pre><code>const value = &quot;&lt;tag&gt;&quot;;\n<\/code><\/pre>/);
});

test("renderMessageBody escapes raw HTML and rejects unsafe links", () => {
  const html = renderMessageBody({
    type: "message",
    role: "user",
    content: "Hello <script>alert(1)</script> [bad](javascript:alert(1)) [mail](mailto:team@example.com)"
  });

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /href="javascript:alert\(1\)"/);
  assert.match(html, /\[bad\]\(javascript:alert\(1\)\)/);
  assert.match(html, /<a href="mailto:team@example\.com" target="_blank" rel="noreferrer">mail<\/a>/);
});

test("message copy text stays as the original markdown source", () => {
  const item = {
    type: "message",
    role: "assistant",
    content: "**Keep markdown** and `code`"
  };

  assert.equal(textForTimelineItem(item), "**Keep markdown** and `code`");
});

test("groupTimelineItems keeps messages as the main timeline", () => {
  const grouped = groupTimelineItems([
    message("m1", "user"),
    command("c1"),
    tool("t1"),
    message("m2", "assistant")
  ]);

  assert.deepEqual(
    grouped.map((item) => item.type),
    ["message", "activity_group", "message"]
  );
  assert.equal(grouped[1].items.length, 2);
});

test("groupTimelineItems does not merge actions across messages", () => {
  const grouped = groupTimelineItems([
    command("c1"),
    message("m1", "user"),
    command("c2"),
    fileChange("f1"),
    message("m2", "assistant"),
    status("s1")
  ]);

  assert.deepEqual(
    grouped.map((item) => (item.type === "activity_group" ? item.items.map((child) => child.id) : item.id)),
    [["c1"], "m1", ["c2", "f1"], "m2", ["s1"]]
  );
});

test("renderActivityGroup summarizes counts and failed actions without opening by default", () => {
  const html = renderActivityGroup({
    type: "activity_group",
    items: [
      command("c1", { exitCode: 1 }),
      command("c2"),
      tool("t1", { status: "failed" }),
      fileChange("f1"),
      status("s1")
    ]
  });

  assert.match(html, /<details class="activity-group" data-tone="bad">/);
  assert.match(html, /5 actions/);
  assert.match(html, /2 commands/);
  assert.match(html, /1 tool/);
  assert.match(html, /1 file/);
  assert.match(html, /1 status/);
  assert.match(html, /2 failed/);
  assert.match(html, /class="activity-item"/);
  assert.doesNotMatch(html, /<details class="activity-group"[^>]*open/);
});

test("findLatestTimelineFocusBlock selects the last message block", () => {
  const blocks = [
    timelineBlock("message", "first"),
    timelineBlock("activity_group", "actions"),
    timelineBlock("message", "latest")
  ];

  assert.equal(findLatestTimelineFocusBlock(blocks).id, "latest");
});

test("findLatestTimelineFocusBlock falls back to the last timeline block without messages", () => {
  const blocks = [
    timelineBlock("activity_group", "actions-1"),
    timelineBlock("activity_group", "actions-2")
  ];

  assert.equal(findLatestTimelineFocusBlock(blocks).id, "actions-2");
});

test("shouldFocusLatestTimeline does not focus during preserved refreshes", () => {
  assert.equal(shouldFocusLatestTimeline({ preserveSelection: false }), true);
  assert.equal(shouldFocusLatestTimeline({ preserveSelection: true }), false);
});

function message(id, role) {
  return {
    id,
    type: "message",
    role,
    createdAt: "2026-07-05T09:00:00.000Z",
    content: `${role} says hello`
  };
}

function command(id, overrides = {}) {
  return {
    id,
    type: "command",
    createdAt: "2026-07-05T09:00:01.000Z",
    command: "npm test",
    output: "ok",
    ...overrides
  };
}

function tool(id, overrides = {}) {
  return {
    id,
    type: "tool_call",
    createdAt: "2026-07-05T09:00:02.000Z",
    name: "apply_patch",
    status: "complete",
    input: "*** Begin Patch",
    output: "Success",
    ...overrides
  };
}

function fileChange(id) {
  return {
    id,
    type: "file_change",
    createdAt: "2026-07-05T09:00:03.000Z",
    path: "src/app.js",
    summary: "update src/app.js",
    diff: "@@ -1 +1 @@\n-old\n+new\n"
  };
}

function status(id) {
  return {
    id,
    type: "status",
    createdAt: "2026-07-05T09:00:04.000Z",
    status: "running",
    detail: "running command"
  };
}

function timelineBlock(type, id) {
  return {
    id,
    dataset: {
      timelineType: type
    }
  };
}
