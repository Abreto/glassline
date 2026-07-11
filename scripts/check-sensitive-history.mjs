#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PLACEHOLDER_HOME_NAMES = new Set(["example", "me", "user"]);
const RULES = [
  {
    id: "private-key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g
  },
  {
    id: "github-token",
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,255}\b/g
  },
  {
    id: "aws-access-key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g
  },
  {
    id: "openai-api-key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g
  },
  {
    id: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g
  },
  {
    id: "google-api-key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g
  },
  {
    id: "home-directory",
    pattern: /\/(?:Users|home)\/([A-Za-z0-9._-]+)(?=$|[\/\s"'`])/g,
    accept: (match) => !PLACEHOLDER_HOME_NAMES.has(match[1].toLowerCase())
  }
];

export function scanText(content, { objectId, path: filePath }) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
  if (buffer.includes(0)) {
    return [];
  }

  const text = buffer.toString("utf8");
  const findings = [];

  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      if (rule.accept && !rule.accept(match)) {
        continue;
      }
      findings.push({
        objectId,
        path: filePath,
        ruleId: rule.id,
        fingerprint: fingerprint(match[0])
      });
    }
  }

  return findings;
}

export function scanRepository({ cwd, baseline = [] }) {
  const objectLines = git(cwd, ["rev-list", "--objects", "--all"], "utf8")
    .split("\n")
    .filter(Boolean);
  const seen = new Set();
  const findings = [];
  let scannedBlobs = 0;

  for (const line of objectLines) {
    const separator = line.indexOf(" ");
    if (separator === -1) {
      continue;
    }
    const objectId = line.slice(0, separator);
    const filePath = line.slice(separator + 1);
    const key = `${objectId}\0${filePath}`;
    if (!filePath || seen.has(key)) {
      continue;
    }
    seen.add(key);

    if (git(cwd, ["cat-file", "-t", objectId], "utf8").trim() !== "blob") {
      continue;
    }

    const content = git(cwd, ["cat-file", "-p", objectId]);
    scannedBlobs += 1;
    findings.push(...scanText(content, { objectId, path: filePath }));
  }

  return {
    scannedBlobs,
    findings,
    ...applyFindingBaseline(findings, baseline)
  };
}

export function applyFindingBaseline(findings, baseline) {
  const approved = new Set(baseline.map(findingKey));
  const waived = [];
  const unapproved = [];

  for (const finding of findings) {
    (approved.has(findingKey(finding)) ? waived : unapproved).push(finding);
  }

  return { waived, unapproved };
}

export function run(argv = process.argv.slice(2), { cwd = process.cwd() } = {}) {
  try {
    const repoRoot = git(cwd, ["rev-parse", "--show-toplevel"], "utf8").trim();
    const baselinePath = baselinePathFromArgs(argv, repoRoot);
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    if (!Array.isArray(baseline)) {
      throw new Error(`Sensitive history baseline must be a JSON array: ${baselinePath}`);
    }

    const result = scanRepository({ cwd: repoRoot, baseline });
    if (result.unapproved.length > 0) {
      console.error(
        `Sensitive history scan found ${result.unapproved.length} unapproved finding(s):`
      );
      for (const finding of result.unapproved) {
        console.error(`- ${finding.ruleId} ${finding.path} ${finding.objectId}`);
      }
      return 1;
    }

    console.log(
      `Sensitive history scan passed: ${result.scannedBlobs} blob(s) scanned, ${result.waived.length} baseline waiver(s).`
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}

function findingKey(finding) {
  return [finding.objectId, finding.path, finding.ruleId, finding.fingerprint].join("\0");
}

function baselinePathFromArgs(argv, repoRoot) {
  if (argv.length === 0) {
    return path.join(repoRoot, "scripts", "sensitive-history-baseline.json");
  }
  if (argv.length === 2 && argv[0] === "--baseline") {
    return path.resolve(repoRoot, argv[1]);
  }
  throw new Error("Usage: node scripts/check-sensitive-history.mjs [--baseline <path>]");
}

function git(cwd, args, encoding) {
  return execFileSync("git", args, {
    cwd,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = run();
}
