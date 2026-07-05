export function groupTimelineItems(items) {
  const grouped = [];
  let pendingActions = [];

  for (const item of items) {
    if (item.type === "message") {
      flushActions(grouped, pendingActions);
      pendingActions = [];
      grouped.push(item);
    } else {
      pendingActions.push(item);
    }
  }

  flushActions(grouped, pendingActions);
  return grouped;
}

export function findLatestTimelineFocusBlock(blocks) {
  const list = Array.from(blocks);
  const latestMessage = [...list]
    .reverse()
    .find((block) => block.dataset?.timelineType === "message");

  return latestMessage ?? list.at(-1) ?? null;
}

export function shouldFocusLatestTimeline({ preserveSelection } = {}) {
  return !preserveSelection;
}

export function renderCommandBody(item) {
  return `
    <pre class="command-text">${escapeHtml(item.command)}</pre>
    ${item.output ? renderCollapsedOutput(item.output) : ""}
  `;
}

export function renderActivityGroup(group) {
  const tone = group.items.some(isFailedAction) ? "bad" : "neutral";
  return `
    <details class="activity-group" data-tone="${tone}">
      <summary>${escapeHtml(activitySummary(group.items))}</summary>
      <div class="activity-items">
        ${group.items.map(renderActivityItem).join("")}
      </div>
    </details>
  `;
}

export function textForTimelineItem(item) {
  if (item.type === "command") {
    return [item.command, item.output].filter(Boolean).join("\n\n");
  }

  if (item.type === "file_change") {
    return [item.path, item.summary, item.diff].filter(Boolean).join("\n\n");
  }

  if (item.type === "tool_call") {
    return JSON.stringify({ name: item.name, input: item.input, output: item.output }, null, 2);
  }

  return item.content ?? item.detail ?? "";
}

export function titleForTimelineItem(item) {
  if (item.type === "activity_group") {
    return "activity";
  }

  if (item.type === "message") {
    return `${item.role} message`;
  }

  if (item.type === "command") {
    return `command${item.exitCode === undefined || item.exitCode === null ? "" : ` · exit ${item.exitCode}`}`;
  }

  if (item.type === "file_change") {
    return `file · ${item.path}`;
  }

  if (item.type === "tool_call") {
    return `tool · ${item.name}`;
  }

  return `status · ${item.status}`;
}

function flushActions(grouped, actions) {
  if (actions.length === 0) {
    return;
  }

  grouped.push({
    id: `activity:${actions[0].id}:${actions.length}`,
    type: "activity_group",
    createdAt: actions[0].createdAt,
    items: actions
  });
}

function renderActivityItem(item) {
  return `
    <section class="activity-item" data-kind="${escapeHtml(item.type)}">
      <header class="activity-item-header">
        <strong>${escapeHtml(titleForTimelineItem(item))}</strong>
        ${isFailedAction(item) ? '<span class="badge" data-tone="bad">FAILED</span>' : ""}
      </header>
      <div class="activity-item-body">
        ${bodyForActivityItem(item)}
      </div>
    </section>
  `;
}

function bodyForActivityItem(item) {
  if (item.type === "command") {
    return renderCommandBody(item);
  }

  if (item.type === "tool_call") {
    return renderToolCallBody(item);
  }

  if (item.type === "file_change") {
    return renderFileChangeBody(item);
  }

  if (item.type === "status") {
    return `<p>${escapeHtml(item.detail ?? item.status ?? "")}</p>`;
  }

  return `<p>${escapeHtml(textForTimelineItem(item))}</p>`;
}

function renderToolCallBody(item) {
  return `
    <p>${escapeHtml(item.name ?? "tool")} · ${escapeHtml(item.status ?? "unknown")}</p>
    ${item.input !== undefined ? renderCollapsedOutputWithLabel(formatUnknown(item.input), "Show input") : ""}
    ${item.output !== undefined ? renderCollapsedOutputWithLabel(formatUnknown(item.output), "Show output") : ""}
  `;
}

function renderFileChangeBody(item) {
  return `
    <p>${escapeHtml(item.summary ?? item.path)}</p>
    ${item.diff ? renderCollapsedOutputWithLabel(item.diff, "Show diff") : ""}
  `;
}

function renderCollapsedOutput(output) {
  return renderCollapsedOutputWithLabel(output, "Show output");
}

function renderCollapsedOutputWithLabel(output, label) {
  return `
    <details class="command-output">
      <summary>${escapeHtml(outputSummary(output, label))}</summary>
      <pre>${escapeHtml(output)}</pre>
    </details>
  `;
}

function outputSummary(output, label) {
  const lines = String(output).split("\n").length;
  return `${label} (${lines} ${lines === 1 ? "line" : "lines"})`;
}

function activitySummary(items) {
  const counts = items.reduce(
    (result, item) => {
      result.total += 1;
      if (item.type === "command") result.commands += 1;
      if (item.type === "tool_call") result.tools += 1;
      if (item.type === "file_change") result.files += 1;
      if (item.type === "status") result.status += 1;
      if (isFailedAction(item)) result.failed += 1;
      return result;
    },
    { total: 0, commands: 0, tools: 0, files: 0, status: 0, failed: 0 }
  );

  return [
    plural(counts.total, "action"),
    counts.commands ? plural(counts.commands, "command") : null,
    counts.tools ? plural(counts.tools, "tool") : null,
    counts.files ? plural(counts.files, "file") : null,
    counts.status ? plural(counts.status, "status", "status") : null,
    counts.failed ? plural(counts.failed, "failed", "failed") : null
  ]
    .filter(Boolean)
    .join(" · ");
}

function plural(count, singular, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function isFailedAction(item) {
  if (item.type === "command") {
    return typeof item.exitCode === "number" && item.exitCode !== 0;
  }

  return item.status === "failed";
}

function formatUnknown(value) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
