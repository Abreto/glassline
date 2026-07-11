import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyFindingBaseline,
  scanRepository,
  scanText
} from "../scripts/check-sensitive-history.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts/check-sensitive-history.mjs");

test("scanText finds common secrets and private home paths without returning matched values", () => {
  const githubToken = "gh" + "p_" + "a".repeat(36);
  const privatePath = "/" + "Users/alice/private-project";
  const findings = scanText(`${githubToken}\n${privatePath}\n`, {
    objectId: "abc123",
    path: "notes.txt"
  });

  assert.deepEqual(
    findings.map(({ ruleId, objectId, path: findingPath }) => ({
      ruleId,
      objectId,
      path: findingPath
    })),
    [
      { ruleId: "github-token", objectId: "abc123", path: "notes.txt" },
      { ruleId: "home-directory", objectId: "abc123", path: "notes.txt" }
    ]
  );
  assert.equal(findings.some((finding) => JSON.stringify(finding).includes(githubToken)), false);
  assert.equal(findings.some((finding) => JSON.stringify(finding).includes(privatePath)), false);
});

test("scanText skips binary data and placeholder home paths", () => {
  const token = "gh" + "p_" + "b".repeat(36);

  assert.deepEqual(
    scanText(Buffer.from(`binary\0${token}`), { objectId: "one", path: "binary.dat" }),
    []
  );
  assert.deepEqual(
    scanText("/Users/example/project\n/home/user/project\n/Users/a&b/project\n", {
      objectId: "two",
      path: "example.txt"
    }),
    []
  );
});

test("scanRepository reads sensitive content from reachable historical blobs", async () => {
  const fixture = await createHistoryFixture();
  const result = scanRepository({ cwd: fixture.directory, baseline: [] });

  assert.equal(result.findings.some((finding) => finding.ruleId === "github-token"), true);
  assert.equal(result.findings.some((finding) => finding.ruleId === "home-directory"), true);
  assert.equal(result.findings.some((finding) => finding.path === "binary.dat"), false);
  assert.ok(result.scannedBlobs >= 3);
});

test("applyFindingBaseline requires an exact object, path, rule, and fingerprint match", async () => {
  const fixture = await createHistoryFixture();
  const result = scanRepository({ cwd: fixture.directory, baseline: [] });
  const finding = result.findings.find((candidate) => candidate.ruleId === "github-token");

  const approved = applyFindingBaseline(result.findings, [finding]);
  assert.equal(approved.waived.length, 1);
  assert.equal(approved.unapproved.length, result.findings.length - 1);

  const wrongObject = applyFindingBaseline(result.findings, [
    { ...finding, objectId: "0000000000000000000000000000000000000000" }
  ]);
  assert.equal(wrongObject.waived.length, 0);
});

test("history scan CLI exits nonzero for unapproved findings and passes with an exact baseline", async () => {
  const fixture = await createHistoryFixture();
  const baselinePath = path.join(fixture.directory, "baseline.json");
  await writeFile(baselinePath, "[]\n", "utf8");

  const failed = spawnSync(process.execPath, [scriptPath, "--baseline", baselinePath], {
    cwd: fixture.directory,
    encoding: "utf8"
  });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Sensitive history scan found \d+ unapproved finding/);

  const result = scanRepository({ cwd: fixture.directory, baseline: [] });
  await writeFile(baselinePath, `${JSON.stringify(result.findings, null, 2)}\n`, "utf8");
  const passed = spawnSync(process.execPath, [scriptPath, "--baseline", baselinePath], {
    cwd: fixture.directory,
    encoding: "utf8"
  });
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /baseline waiver\(s\)/);
  assert.doesNotMatch(passed.stdout, /ghp_/);
});

async function createHistoryFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "glassline-sensitive-history-"));
  runGit(directory, "init", "-q");
  runGit(directory, "config", "user.name", "Fixture User");
  runGit(directory, "config", "user.email", "fixture@example.com");

  const token = "gh" + "p_" + "c".repeat(36);
  const privatePath = "/" + "Users/alice/workspace";
  await writeFile(path.join(directory, "secret.txt"), `${token}\n${privatePath}\n`, "utf8");
  await writeFile(path.join(directory, "placeholder.txt"), "/Users/example/project\n", "utf8");
  await writeFile(path.join(directory, "binary.dat"), Buffer.from(`binary\0${token}`));
  runGit(directory, "add", ".");
  runGit(directory, "commit", "-qm", "add fixture history");

  await writeFile(path.join(directory, "secret.txt"), "sanitized\n", "utf8");
  runGit(directory, "add", "secret.txt");
  runGit(directory, "commit", "-qm", "sanitize fixture history");

  return { directory };
}

function runGit(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}
