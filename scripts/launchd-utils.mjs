import path from "node:path";

export const GLASSLINE_LAUNCHD_LABEL = "com.glassline.local";

export function launchdPaths(homeDir) {
  const launchAgentsDir = path.join(homeDir, "Library", "LaunchAgents");
  const logDir = path.join(homeDir, "Library", "Logs", "glassline");

  return {
    launchAgentsDir,
    plistPath: path.join(launchAgentsDir, `${GLASSLINE_LAUNCHD_LABEL}.plist`),
    logDir,
    stdoutPath: path.join(logDir, "stdout.log"),
    stderrPath: path.join(logDir, "stderr.log")
  };
}

export function buildLaunchdPlist({ repoRoot, nodePath, paths, controlToken, codexBin }) {
  const serverPath = path.join(repoRoot, "src", "server.mjs");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(GLASSLINE_LAUNCHD_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(serverPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOST</key>
    <string>127.0.0.1</string>
    <key>PORT</key>
    <string>6280</string>
    <key>GLASSLINE_MOCK</key>
    <string>0</string>
${launchdEnvironmentEntry("GLASSLINE_CONTROL_TOKEN", controlToken)}${launchdEnvironmentEntry("GLASSLINE_CODEX_BIN", codexBin)}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(paths.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(paths.stderrPath)}</string>
</dict>
</plist>
`;
}

export function launchdPlistWriteOptions({ controlToken } = {}) {
  return {
    encoding: "utf8",
    mode: controlToken ? 0o600 : 0o644
  };
}

export async function uninstallLaunchdService({
  paths,
  uid = process.getuid(),
  runLaunchctl,
  removeFile,
  log = console.log
}) {
  await runIgnoringMissing(runLaunchctl, ["bootout", serviceTarget(uid)], log);
  await runIgnoringMissing(runLaunchctl, ["unload", paths.plistPath], log);

  try {
    await removeFile(paths.plistPath);
    log(`Removed ${paths.plistPath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

export function isIgnorableLaunchctlError(error) {
  const text = [error?.message, error?.stdout, error?.stderr].filter(Boolean).join("\n").toLowerCase();

  return (
    error?.code === 3 ||
    text.includes("could not find service") ||
    text.includes("no such process") ||
    text.includes("not loaded") ||
    text.includes("boot-out failed: 5") ||
    text.includes("input/output error") ||
    text.includes("no such file")
  );
}

export function serviceTarget(uid = process.getuid()) {
  return `${userDomain(uid)}/${GLASSLINE_LAUNCHD_LABEL}`;
}

export function userDomain(uid = process.getuid()) {
  return `gui/${uid}`;
}

async function runIgnoringMissing(runLaunchctl, args, log) {
  try {
    await runLaunchctl(...args);
  } catch (error) {
    if (!isIgnorableLaunchctlError(error)) {
      throw error;
    }
    log(`Ignored launchctl ${args.join(" ")}: service was not loaded`);
  }
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function launchdEnvironmentEntry(key, value) {
  if (!value) {
    return "";
  }
  return `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>\n`;
}
