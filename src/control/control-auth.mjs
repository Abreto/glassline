import { timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import path from "node:path";

const CONTROL_TOKEN = Symbol("controlToken");

export function parseControlConfig(env = process.env) {
  const token = env.GLASSLINE_CONTROL_TOKEN;
  if (token === undefined || token === "") {
    return { enabled: false };
  }

  if (token !== token.trim()) {
    throw new Error("GLASSLINE_CONTROL_TOKEN must not contain leading or trailing whitespace");
  }

  if (/\p{Cc}/u.test(token)) {
    throw new Error("GLASSLINE_CONTROL_TOKEN must not contain control characters");
  }

  if (Array.from(token).length < 32) {
    throw new Error("GLASSLINE_CONTROL_TOKEN must be at least 32 characters");
  }

  const config = {
    enabled: true,
    ...(env.GLASSLINE_CODEX_BIN ? { codexBin: env.GLASSLINE_CODEX_BIN } : {})
  };
  Object.defineProperty(config, CONTROL_TOKEN, {
    value: Buffer.from(token, "utf8"),
    enumerable: false
  });
  return config;
}

export function authorizeControlHeader(header, config) {
  if (!config?.enabled || typeof header !== "string") {
    return false;
  }

  const match = header.match(/^Bearer ([^\s]+)$/);
  if (!match) {
    return false;
  }

  const expected = config[CONTROL_TOKEN];
  const actual = Buffer.from(match[1], "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function resolveCodexBinary(
  config,
  { access = fsAccess, env = process.env } = {}
) {
  if (!config?.enabled) {
    return null;
  }

  if (config.codexBin) {
    if (!path.isAbsolute(config.codexBin)) {
      throw new Error("GLASSLINE_CODEX_BIN must be an absolute path");
    }
    await assertExecutable(config.codexBin, access);
    return config.codexBin;
  }

  for (const directory of String(env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, "codex");
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH without invoking a shell.
    }
  }

  throw new Error("Codex executable not found; set GLASSLINE_CODEX_BIN to an absolute path");
}

async function assertExecutable(filePath, access) {
  try {
    await access(filePath, constants.X_OK);
  } catch {
    throw new Error(`Codex executable is not available: ${filePath}`);
  }
}
