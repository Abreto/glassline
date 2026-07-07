import assert from "node:assert/strict";
import test from "node:test";

import { requestJson, renderErrorState } from "../public/api-client.js";

test("requestJson wraps network failures with the UI action label", async () => {
  await assert.rejects(
    () =>
      requestJson("/api/sessions", {
        fetchImpl: async () => {
          throw new Error("connection refused");
        },
        label: "Unable to load sessions"
      }),
    /Unable to load sessions: connection refused/
  );
});

test("requestJson includes API error payloads for unsuccessful responses", async () => {
  await assert.rejects(
    () =>
      requestJson("/api/raw/codex%3Aone", {
        fetchImpl: async () => ({
          ok: false,
          status: 500,
          json: async () => ({ error: "adapter unavailable" })
        }),
        label: "Unable to load raw data"
      }),
    /Unable to load raw data: adapter unavailable/
  );
});

test("renderErrorState shows an escaped alert-style empty state", () => {
  const html = renderErrorState("Load failed", "Bad <script>alert(1)</script>");

  assert.match(html, /role="alert"/);
  assert.match(html, /Load failed/);
  assert.match(html, /Bad &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
