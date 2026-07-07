import assert from "node:assert/strict";
import test from "node:test";

import {
  captureOpenDisclosureIds,
  findLatestTimelineFocusBlock,
  groupTimelineItems,
  renderActivityGroup,
  renderCommandBody,
  renderMessageBody,
  restoreOpenDisclosureIds,
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

  assert.match(html, /<details class="activity-group" data-tone="bad" data-disclosure-id="activity:c1">/);
  assert.match(html, /5 actions/);
  assert.match(html, /2 commands/);
  assert.match(html, /1 tool/);
  assert.match(html, /1 file/);
  assert.match(html, /1 status/);
  assert.match(html, /2 failed/);
  assert.match(html, /class="activity-item"/);
  assert.doesNotMatch(html, /<details class="activity-group"[^>]*open/);
});

test("activity group disclosure id stays stable when more actions arrive", () => {
  const firstRender = renderActivityGroup({
    type: "activity_group",
    id: "activity:c1:1",
    items: [command("c1")]
  });
  const nextRender = renderActivityGroup({
    type: "activity_group",
    id: "activity:c1:2",
    items: [command("c1"), tool("t1")]
  });

  assert.match(firstRender, /data-disclosure-id="activity:c1"/);
  assert.match(nextRender, /data-disclosure-id="activity:c1"/);
  assert.doesNotMatch(nextRender, /data-disclosure-id="activity:c1:2"/);
});

test("nested disclosure ids use timeline item ids with output labels", () => {
  const commandHtml = renderCommandBody(command("c1"));
  const groupHtml = renderActivityGroup({
    type: "activity_group",
    items: [tool("t1"), fileChange("f1")]
  });

  assert.match(commandHtml, /data-disclosure-id="c1:output"/);
  assert.match(groupHtml, /data-disclosure-id="t1:input"/);
  assert.match(groupHtml, /data-disclosure-id="t1:output"/);
  assert.match(groupHtml, /data-disclosure-id="f1:diff"/);
});

test("captureOpenDisclosureIds and restoreOpenDisclosureIds preserve matching open details", () => {
  const closed = detail("activity:c1", false);
  const open = detail("c1:output", true);
  const missing = detail("", true);
  const restored = detail("c1:output", false);
  const newDisclosure = detail("t1:output", false);

  const captured = captureOpenDisclosureIds(fakeRoot([closed, open, missing]));
  restoreOpenDisclosureIds(fakeRoot([restored, newDisclosure]), captured);

  assert.deepEqual([...captured], ["c1:output"]);
  assert.equal(restored.open, true);
  assert.equal(newDisclosure.open, false);
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

function detail(id, open) {
  return {
    dataset: {
      disclosureId: id
    },
    open
  };
}

function fakeRoot(disclosures) {
  return {
    querySelectorAll(selector) {
      return selector === "details[data-disclosure-id]" ? disclosures : [];
    }
  };
}
