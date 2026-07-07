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

export function captureOpenDisclosureIds(root) {
  return new Set(
    [...root.querySelectorAll("details[data-disclosure-id]")]
      .filter((node) => node.open)
      .map((node) => node.dataset.disclosureId)
      .filter(Boolean)
  );
}

export function restoreOpenDisclosureIds(root, openIds) {
  for (const node of root.querySelectorAll("details[data-disclosure-id]")) {
    node.open = openIds.has(node.dataset.disclosureId);
  }
}

export function renderCommandBody(item) {
  return `
    <pre class="command-text">${escapeHtml(item.command)}</pre>
    ${item.output ? renderCollapsedOutput(item.output, disclosureId(item, "output")) : ""}
  `;
}

export function renderMessageBody(item) {
  return `<div class="message-markdown">${renderMarkdown(textForTimelineItem(item))}</div>`;
}

export function renderMarkdown(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    if (isBlank(lines[index])) {
      index += 1;
      continue;
    }

    const codeFence = lines[index].match(/^```\w*[\t ]*$/);
    if (codeFence) {
      const codeLines = [];
      index += 1;

      while (index < lines.length && !/^```[\t ]*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}${codeLines.length ? "\n" : ""}</code></pre>`);
      continue;
    }

    const heading = lines[index].match(/^(#{1,3})[\t ]+(.+?)\s*#*$/);
    if (heading) {
      const level = heading[1].length + 2;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*>/.test(lines[index])) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${renderParagraph(quoteLines)}</blockquote>`);
      continue;
    }

    const unorderedList = lines[index].match(/^\s*[-*]\s+(.+)$/);
    if (unorderedList) {
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*[-*]\s+(.+)$/);
        if (!item) break;
        items.push(`<li>${renderInlineMarkdown(item[1])}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const orderedList = lines[index].match(/^\s*\d+[.)]\s+(.+)$/);
    if (orderedList) {
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*\d+[.)]\s+(.+)$/);
        if (!item) break;
        items.push(`<li>${renderInlineMarkdown(item[1])}</li>`);
        index += 1;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && !isBlank(lines[index]) && !startsMarkdownBlock(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push(renderParagraph(paragraphLines));
  }

  return blocks.join("");
}

export function renderActivityGroup(group) {
  const tone = group.items.some(isFailedAction) ? "bad" : "neutral";
  return `
    <details class="activity-group" data-tone="${tone}" data-disclosure-id="${escapeHtml(activityGroupDisclosureId(group))}">
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
    id: `activity:${actions[0].id}`,
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
    ${
      item.input !== undefined
        ? renderCollapsedOutputWithLabel(formatUnknown(item.input), "Show input", disclosureId(item, "input"))
        : ""
    }
    ${
      item.output !== undefined
        ? renderCollapsedOutputWithLabel(formatUnknown(item.output), "Show output", disclosureId(item, "output"))
        : ""
    }
  `;
}

function renderFileChangeBody(item) {
  return `
    <p>${escapeHtml(item.summary ?? item.path)}</p>
    ${item.diff ? renderCollapsedOutputWithLabel(item.diff, "Show diff", disclosureId(item, "diff")) : ""}
  `;
}

function renderCollapsedOutput(output, id) {
  return renderCollapsedOutputWithLabel(output, "Show output", id);
}

function renderCollapsedOutputWithLabel(output, label, id) {
  const disclosureAttr = id ? ` data-disclosure-id="${escapeHtml(id)}"` : "";
  return `
    <details class="command-output"${disclosureAttr}>
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

function activityGroupDisclosureId(group) {
  return `activity:${group.items[0]?.id ?? group.id ?? "unknown"}`;
}

function disclosureId(item, suffix) {
  return item.id ? `${item.id}:${suffix}` : "";
}

function renderParagraph(lines) {
  return `<p>${lines.map(renderInlineMarkdown).join("<br>")}</p>`;
}

function renderInlineMarkdown(value) {
  const tokens = [];
  let text = String(value ?? "");

  text = tokenize(text, /`([^`\n]+)`/g, (match) => `<code>${escapeHtml(match[1])}</code>`, tokens);
  text = tokenize(
    text,
    /\[([^\]\n]+)\]\(([^)\s]+)\)/g,
    (match) => {
      const label = escapeHtml(match[1]);
      const href = match[2];

      return isSafeHref(href)
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>`
        : escapeHtml(match[0]);
    },
    tokens
  );
  text = tokenize(text, /\*\*([^*\n]+)\*\*/g, (match) => `<strong>${escapeHtml(match[1])}</strong>`, tokens);
  text = tokenize(text, /\*([^*\n]+)\*/g, (match) => `<em>${escapeHtml(match[1])}</em>`, tokens);

  return restoreTokens(escapeHtml(text), tokens);
}

function tokenize(text, pattern, renderToken, tokens) {
  return text.replace(pattern, (...args) => {
    const match = args[0];
    const token = `\u0000GLASSLINE_MD_${tokens.length}\u0000`;
    tokens.push([token, renderToken(args.slice(0, -2), match)]);
    return token;
  });
}

function restoreTokens(text, tokens) {
  let result = text;
  for (const [token, html] of tokens) {
    result = result.replaceAll(token, html);
  }
  return result;
}

function isSafeHref(href) {
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function isBlank(line) {
  return !line.trim();
}

function startsMarkdownBlock(line) {
  return (
    /^```\w*[\t ]*$/.test(line) ||
    /^(#{1,3})[\t ]+/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line)
  );
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
