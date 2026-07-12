import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeControlHeader,
  parseControlConfig,
  resolveCodexBinary
} from "../src/control/control-auth.mjs";

const TOKEN = "abcdefghijklmnopqrstuvwxyz123456";

test("parseControlConfig keeps control disabled without a token", () => {
  assert.deepEqual(parseControlConfig({}), { enabled: false });
});

test("parseControlConfig validates enabled control tokens", () => {
  assert.throws(
    () => parseControlConfig({ GLASSLINE_CONTROL_TOKEN: "short" }),
    /at least 32 characters/
  );
  assert.throws(
    () => parseControlConfig({ GLASSLINE_CONTROL_TOKEN: ` ${TOKEN}` }),
    /leading or trailing whitespace/
  );
  assert.throws(
    () => parseControlConfig({ GLASSLINE_CONTROL_TOKEN: `${TOKEN}\n` }),
    /control characters|whitespace/
  );

  const config = parseControlConfig({
    GLASSLINE_CONTROL_TOKEN: TOKEN,
    GLASSLINE_CODEX_BIN: "/opt/example/codex"
  });
  assert.equal(config.enabled, true);
  assert.equal(config.codexBin, "/opt/example/codex");
  assert.equal("token" in config, false);
});

test("authorizeControlHeader accepts only the exact Bearer token", () => {
  const config = parseControlConfig({ GLASSLINE_CONTROL_TOKEN: TOKEN });

  assert.equal(authorizeControlHeader(undefined, config), false);
  assert.equal(authorizeControlHeader(TOKEN, config), false);
  assert.equal(authorizeControlHeader("Basic abc", config), false);
  assert.equal(authorizeControlHeader(`Bearer ${TOKEN}x`, config), false);
  assert.equal(authorizeControlHeader(`Bearer ${TOKEN}`, config), true);
});

test("resolveCodexBinary requires an executable absolute override", async () => {
  const checked = [];
  const access = async (candidate) => {
    checked.push(candidate);
    if (candidate !== "/opt/homebrew/bin/codex") {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }
  };

  assert.equal(
    await resolveCodexBinary(
      { enabled: true, codexBin: "/opt/homebrew/bin/codex" },
      { access, env: { PATH: "/usr/bin" } }
    ),
    "/opt/homebrew/bin/codex"
  );
  await assert.rejects(
    resolveCodexBinary(
      { enabled: true, codexBin: "codex-custom" },
      { access, env: { PATH: "/usr/bin" } }
    ),
    /absolute path/
  );
  assert.deepEqual(checked, ["/opt/homebrew/bin/codex"]);
});

test("resolveCodexBinary searches PATH without a shell", async () => {
  const access = async (candidate) => {
    if (candidate !== "/opt/homebrew/bin/codex") {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }
  };

  assert.equal(
    await resolveCodexBinary(
      parseControlConfig({ GLASSLINE_CONTROL_TOKEN: TOKEN }),
      { access, env: { PATH: "/usr/bin:/opt/homebrew/bin" } }
    ),
    "/opt/homebrew/bin/codex"
  );
});
