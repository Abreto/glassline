#!/usr/bin/env node
import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  buildLaunchdPlist,
  GLASSLINE_LAUNCHD_LABEL,
  launchdPaths,
  serviceTarget,
  uninstallLaunchdService,
  userDomain,
  writeLaunchdPlist
} from "./launchd-utils.mjs";
import { parseControlConfig, resolveCodexBinary } from "../src/control/control-auth.mjs";

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = launchdPaths(os.homedir());

await main();

async function main() {
  ensureMacOS();
  const uid = process.getuid();
  const controlConfig = parseControlConfig(process.env);
  const codexBin = controlConfig.enabled ? await resolveCodexBinary(controlConfig) : undefined;
  const controlToken = controlConfig.enabled ? process.env.GLASSLINE_CONTROL_TOKEN : undefined;

  await mkdir(paths.launchAgentsDir, { recursive: true });
  await mkdir(paths.logDir, { recursive: true });

  await uninstallLaunchdService({
    paths,
    uid,
    runLaunchctl,
    removeFile: async () => {},
    log: () => {}
  });

  await writeLaunchdPlist({
    filePath: paths.plistPath,
    contents: buildLaunchdPlist({
      repoRoot,
      nodePath: process.execPath,
      paths,
      controlToken,
      codexBin
    }),
    controlToken,
    writeFile,
    chmodFile: chmod
  });

  await bootstrapService(uid);
  await startService(uid);

  console.log(`Installed ${GLASSLINE_LAUNCHD_LABEL}`);
  console.log(`Plist: ${paths.plistPath}`);
  console.log("URL: http://127.0.0.1:6280");
  console.log(`Logs: ${paths.stdoutPath} and ${paths.stderrPath}`);
}

async function bootstrapService(uid) {
  try {
    await runLaunchctl("bootstrap", userDomain(uid), paths.plistPath);
  } catch {
    await runLaunchctl("load", paths.plistPath);
  }
}

async function startService(uid) {
  try {
    await runLaunchctl("kickstart", "-k", serviceTarget(uid));
  } catch {
    await runLaunchctl("start", GLASSLINE_LAUNCHD_LABEL);
  }
}

async function runLaunchctl(...args) {
  return execFileAsync("launchctl", args);
}

function ensureMacOS() {
  if (process.platform !== "darwin") {
    console.error("Glassline launchd install is only supported on macOS.");
    process.exit(1);
  }
}
