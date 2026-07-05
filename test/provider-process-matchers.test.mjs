import assert from "node:assert/strict";
import test from "node:test";

import { matchesClaudeCodeAgentProcess } from "../src/providers/claude-code.mjs";
import { matchesCodexAgentProcess } from "../src/providers/codex.mjs";

test("codex matcher includes CLI sessions and excludes desktop helper processes", () => {
  assert.equal(matchesCodexAgentProcess({ command: "codex" }), true);
  assert.equal(matchesCodexAgentProcess({ command: "/opt/homebrew/bin/codex exec --json" }), true);
  assert.equal(matchesCodexAgentProcess({ command: "/opt/homebrew/bin/codex app-server --enable goals" }), false);
  assert.equal(
    matchesCodexAgentProcess({
      command:
        "/Applications/Codex.app/Contents/Frameworks/Codex Framework.framework/Helpers/Codex (Renderer).app/Contents/MacOS/Codex (Renderer)"
    }),
    false
  );
});

test("claude-code matcher includes CLI sessions and excludes daemon-only processes", () => {
  assert.equal(matchesClaudeCodeAgentProcess({ command: "claude" }), true);
  assert.equal(
    matchesClaudeCodeAgentProcess({
      command: "/Users/me/.local/share/claude/ClaudeCode.app/Contents/MacOS/claude --session-id abc"
    }),
    true
  );
  assert.equal(
    matchesClaudeCodeAgentProcess({
      command: "/Users/me/.local/bin/claude daemon run --origin transient"
    }),
    false
  );
});
