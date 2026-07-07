import assert from "node:assert/strict";
import test from "node:test";

import {
  GLASSLINE_LAUNCHD_LABEL,
  buildLaunchdPlist,
  isIgnorableLaunchctlError,
  launchdPaths,
  uninstallLaunchdService
} from "../scripts/launchd-utils.mjs";

test("buildLaunchdPlist writes the Glassline launch agent contract", () => {
  const paths = launchdPaths("/Users/me");
  const plist = buildLaunchdPlist({
    repoRoot: "/Users/me/workspace/glassline",
    nodePath: "/opt/homebrew/bin/node",
    paths
  });

  assert.match(plist, new RegExp(`<string>${GLASSLINE_LAUNCHD_LABEL}</string>`));
  assert.match(plist, /<key>WorkingDirectory<\/key>\s*<string>\/Users\/me\/workspace\/glassline<\/string>/);
  assert.match(plist, /<key>ProgramArguments<\/key>\s*<array>\s*<string>\/opt\/homebrew\/bin\/node<\/string>\s*<string>\/Users\/me\/workspace\/glassline\/src\/server\.mjs<\/string>\s*<\/array>/);
  assert.match(plist, /<key>EnvironmentVariables<\/key>\s*<dict>\s*<key>HOST<\/key>\s*<string>127\.0\.0\.1<\/string>\s*<key>PORT<\/key>\s*<string>6280<\/string>\s*<key>GLASSLINE_MOCK<\/key>\s*<string>0<\/string>\s*<\/dict>/);
  assert.match(plist, /<key>StandardOutPath<\/key>\s*<string>\/Users\/me\/Library\/Logs\/glassline\/stdout\.log<\/string>/);
  assert.match(plist, /<key>StandardErrorPath<\/key>\s*<string>\/Users\/me\/Library\/Logs\/glassline\/stderr\.log<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
});

test("buildLaunchdPlist escapes XML text values", () => {
  const plist = buildLaunchdPlist({
    repoRoot: "/tmp/A&B <Glassline>",
    nodePath: "/tmp/node \"quoted\"",
    paths: launchdPaths("/Users/a&b")
  });

  assert.match(plist, /\/tmp\/A&amp;B &lt;Glassline&gt;\/src\/server\.mjs/);
  assert.match(plist, /\/tmp\/node &quot;quoted&quot;/);
  assert.doesNotMatch(plist, /A&B <Glassline>/);
  assert.doesNotMatch(plist, /node "quoted"/);
});

test("launchdPaths returns user-level LaunchAgent and retained log locations", () => {
  assert.deepEqual(launchdPaths("/Users/me"), {
    launchAgentsDir: "/Users/me/Library/LaunchAgents",
    plistPath: "/Users/me/Library/LaunchAgents/com.glassline.local.plist",
    logDir: "/Users/me/Library/Logs/glassline",
    stdoutPath: "/Users/me/Library/Logs/glassline/stdout.log",
    stderrPath: "/Users/me/Library/Logs/glassline/stderr.log"
  });
});

test("isIgnorableLaunchctlError identifies missing or unloaded services", () => {
  assert.equal(isIgnorableLaunchctlError(Object.assign(new Error("No such process"), { code: 3 })), true);
  assert.equal(isIgnorableLaunchctlError({ stderr: "Could not find service \"com.glassline.local\"" }), true);
  assert.equal(isIgnorableLaunchctlError({ stderr: "service is not loaded" }), true);
  assert.equal(isIgnorableLaunchctlError({ stderr: "Operation not permitted" }), false);
});

test("uninstallLaunchdService is idempotent for missing plist and unloaded service", async () => {
  const calls = [];

  await uninstallLaunchdService({
    paths: launchdPaths("/Users/me"),
    uid: 501,
    runLaunchctl: async (...args) => {
      calls.push(["launchctl", ...args]);
      throw { stderr: "Could not find service" };
    },
    removeFile: async (filePath) => {
      calls.push(["unlink", filePath]);
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    log: () => {}
  });

  assert.deepEqual(calls, [
    ["launchctl", "bootout", "gui/501/com.glassline.local"],
    ["launchctl", "bootout", "gui/501", "/Users/me/Library/LaunchAgents/com.glassline.local.plist"],
    ["launchctl", "unload", "/Users/me/Library/LaunchAgents/com.glassline.local.plist"],
    ["unlink", "/Users/me/Library/LaunchAgents/com.glassline.local.plist"]
  ]);
});
