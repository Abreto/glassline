#!/usr/bin/env node
import { execFile } from "node:child_process";
import { unlink } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

import {
  GLASSLINE_LAUNCHD_LABEL,
  launchdPaths,
  uninstallLaunchdService
} from "./launchd-utils.mjs";

const execFileAsync = promisify(execFile);

await main();

async function main() {
  ensureMacOS();

  const paths = launchdPaths(os.homedir());
  await uninstallLaunchdService({
    paths,
    uid: process.getuid(),
    runLaunchctl,
    removeFile: unlink
  });

  console.log(`Uninstalled ${GLASSLINE_LAUNCHD_LABEL}`);
  console.log(`Logs retained in ${paths.logDir}`);
}

async function runLaunchctl(...args) {
  return execFileAsync("launchctl", args);
}

function ensureMacOS() {
  if (process.platform !== "darwin") {
    console.error("Glassline launchd uninstall is only supported on macOS.");
    process.exit(1);
  }
}
