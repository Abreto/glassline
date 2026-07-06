import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("layout keeps the app inside the viewport instead of scrolling body", () => {
  assertRuleIncludes("html,\nbody", ["height: 100%"]);
  assertRuleIncludes("body", ["overflow: hidden"]);
  assertRuleIncludes(".app-shell", ["height: 100dvh", "min-height: 0", "overflow: hidden"]);
});

test("session pane and detail timeline use independent scroll containers", () => {
  assertRuleIncludes(".session-pane", [
    "display: grid",
    "grid-template-rows: auto minmax(0, 1fr)",
    "min-height: 0"
  ]);
  assertRuleIncludes(".session-list", ["min-height: 0", "overflow-y: auto"]);

  assertRuleIncludes(".detail-pane", [
    "display: grid",
    "grid-template-rows: auto auto minmax(0, 1fr)",
    "min-height: 0",
    "overflow: hidden"
  ]);
  assertRuleIncludes(".timeline,\n.raw-view", [
    "display: flex",
    "flex-direction: column",
    "min-height: 0",
    "overflow-y: auto"
  ]);
  assertRuleIncludes(".timeline-block", ["flex: 0 0 auto"]);
});

test("mobile layout keeps the session list as a horizontal strip", () => {
  const media = extractMediaBlock("@media (max-width: 760px)");
  assertRuleIncludes(".app-shell", ["grid-template-columns: 1fr", "grid-template-rows: auto minmax(0, 1fr)"], media);
  assertRuleIncludes(".session-list", ["grid-auto-flow: column", "overflow-x: auto", "overflow-y: hidden"], media);
});

test("message markdown keeps compact timeline typography", () => {
  assertRuleIncludes(".message-markdown", ["display: grid", "gap: 10px", "font-size: 14px"]);
  assertRuleIncludes(".message-markdown p", ["white-space: normal"]);
  assertRuleIncludes(".message-markdown :where(h3, h4, h5)", ["font-size: 14px", "line-height: 1.35"]);
  assertRuleIncludes(".message-markdown code", ["border-radius: 5px", "padding: 1px 4px"]);
  assertRuleIncludes(".message-markdown pre code", ["background: transparent", "border: 0", "padding: 0"]);
});

function assertRuleIncludes(selector, expected, source = css) {
  const rule = extractRule(selector, source);
  for (const declaration of expected) {
    assert.match(rule, declarationPattern(declaration), `${selector} should include ${declaration}`);
  }
}

function extractRule(selector, source) {
  const normalizedSelector = normalizeSelector(selector);
  const rulePattern = /(?<selector>[^{}]+)\{(?<body>[^{}]*)\}/g;

  for (const match of source.matchAll(rulePattern)) {
    if (normalizeSelector(match.groups.selector) === normalizedSelector) {
      return match.groups.body;
    }
  }

  assert.fail(`Missing CSS rule for ${selector}`);
}

function extractMediaBlock(query) {
  const start = css.indexOf(query);
  assert.notEqual(start, -1, `Missing ${query}`);
  const open = css.indexOf("{", start);
  let depth = 0;

  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") {
      depth += 1;
    } else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return css.slice(open + 1, index);
      }
    }
  }

  assert.fail(`Unclosed ${query}`);
}

function declarationPattern(declaration) {
  const [property, value] = declaration.split(":").map((part) => part.trim());
  return new RegExp(`(^|[;\\s])${escapeRegExp(property)}\\s*:\\s*${escapeRegExp(value)}\\s*;`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSelector(selector) {
  return selector
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}
