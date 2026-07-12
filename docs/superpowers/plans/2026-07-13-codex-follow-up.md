# Codex Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, token-protected plain-text follow-up composer that delegates one idle existing Codex session turn to `codex exec resume`.

**Architecture:** Keep read providers unchanged except for conservative `turnState` parsing. A separate Codex follow-up controller owns authentication-independent execution state and spawns the official CLI without a shell; the HTTP app authenticates and validates before calling it. The browser stores the control token and active run ID in `sessionStorage`, polls run state plus the existing timeline, and never creates a second transcript source.

**Tech Stack:** Node.js 20 built-ins, built-in HTTP server, browser-native JavaScript/CSS, Node test runner, synthetic fixtures only.

---

### Task 1: Derive Codex turn lifecycle state

**Files:**
- Modify: `src/core/provider.ts`
- Modify: `src/providers/codex-session-file.mjs`
- Modify: `src/core/session-registry.mjs`
- Modify: `test/fixtures/codex-home/sessions/2026/07/05/rollout-2026-07-05T09-00-00-11111111-1111-4111-8111-111111111111.jsonl`
- Modify: `test/codex-session-file.test.mjs`
- Modify: `test/session-registry.test.mjs`

- [ ] **Step 1: Add failing lifecycle tests**

Assert the last valid lifecycle record maps as follows and malformed lines do not erase prior state:

```js
assert.equal(parseCodexSessionFile(completedFile).turnState, "idle");
assert.equal(parseCodexSessionFile(startedFile).turnState, "running");
assert.equal(parseCodexSessionFile(abortedFile).turnState, "idle");
assert.equal(parseCodexSessionFile(noLifecycleFile).turnState, "unknown");
```

Also assert process merging changes `status` to `running` without changing an idle `turnState`.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test test/codex-session-file.test.mjs test/session-registry.test.mjs`

Expected: assertions fail because `turnState` is absent.

- [ ] **Step 3: Implement conservative parsing and normalization**

Add `TurnState = "running" | "idle" | "unknown"` and `Session.turnState`. While parsing valid JSONL, update state only for `event_msg` payloads `task_started`, `task_complete`, and `turn_aborted`. Summary/stale/process-only sessions use `unknown`; registry normalization defaults missing values to `unknown`.

- [ ] **Step 4: Run focused tests**

Run: `node --test test/codex-session-file.test.mjs test/session-registry.test.mjs`

Expected: all focused tests pass.

### Task 2: Implement control configuration, auth, and Codex execution

**Files:**
- Create: `src/control/control-auth.mjs`
- Create: `src/control/codex-follow-up.mjs`
- Create: `test/control-auth.test.mjs`
- Create: `test/codex-follow-up.test.mjs`

- [ ] **Step 1: Add failing auth tests**

Cover absent control, minimum 32-character trimmed token, control-character rejection, missing/malformed/invalid Bearer values, and valid constant-time comparison. Expected public helpers:

```js
parseControlConfig({ GLASSLINE_CONTROL_TOKEN, GLASSLINE_CODEX_BIN, PATH });
authorizeControlHeader(header, controlConfig);
```

- [ ] **Step 2: Add failing controller tests with a fake child process**

Assert `submitFollowUp()` uses this exact argv and writes the prompt to stdin:

```js
[
  "exec", "resume", "--json",
  "-c", 'approval_policy="on-request"',
  "-c", 'approvals_reviewer="auto_review"',
  sessionUuid, "-"
]
```

Assert `shell:false`, session cwd, inherited environment, one active run per session, JSONL complete/failed handling, spawn/nonzero errors, bounded error output, ten-minute expiry, 100-record cap, lock release, and no retained prompt.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `node --test test/control-auth.test.mjs test/codex-follow-up.test.mjs`

Expected: imports fail because the modules do not exist.

- [ ] **Step 4: Implement the auth and controller modules**

Use `crypto.timingSafeEqual`, `crypto.randomUUID`, `child_process.spawn`, and `readline.createInterface`. Resolve an explicit binary only when absolute and executable; otherwise search PATH entries for an executable named `codex` without a shell. Keep run records shaped as:

```js
{ id, sessionId, status: "running" | "complete" | "failed", startedAt, completedAt?, error? }
```

Keep prompts and raw event streams out of run records.

- [ ] **Step 5: Run focused tests**

Run: `node --test test/control-auth.test.mjs test/codex-follow-up.test.mjs`

Expected: all focused tests pass.

### Task 3: Add authenticated HTTP control APIs

**Files:**
- Modify: `src/http-app.mjs`
- Modify: `src/server.mjs`
- Modify: `test/http-server.test.mjs`

- [ ] **Step 1: Add failing handler tests**

Cover `GET /api/control`, authenticated discovery, disabled-control `404`, `POST /api/sessions/:id/follow-up`, `GET /api/control/runs/:runId`, JSON content type, 20 KiB body and 16 KiB prompt limits, malformed UTF-8/JSON, empty prompts, `401/404/409/413/422/503`, and security headers. Assert untrusted Host and unauthorized requests never read providers or call the controller.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test test/http-server.test.mjs`

Expected: control routes return the existing `405` or `404` behavior.

- [ ] **Step 3: Implement route-specific method handling and bounded JSON reading**

Change `createRequestHandler` to accept `controlConfig` and optional `followUpController`. Keep GET routes unchanged. Add only these control routes:

```text
GET  /api/control
POST /api/sessions/:id/follow-up
GET  /api/control/runs/:runId
```

Validate Host, method/route, enabled state, Bearer token, body, session existence, Codex session-file UUID, `turnState === "idle"`, project directory, and controller lock in that order. Return the exact status shapes from the design specification.

- [ ] **Step 4: Assemble control in server startup**

Parse environment before provider construction. When control is enabled, resolve the Codex binary and create the controller; invalid token or missing binary prints one line and exits. Inject the existing provider registry lookup into the controller rather than extending `ProviderAdapter` with writes.

- [ ] **Step 5: Run backend tests**

Run: `node --test test/http-security.test.mjs test/http-server.test.mjs test/control-auth.test.mjs test/codex-follow-up.test.mjs`

Expected: all backend control and existing security tests pass.

### Task 4: Add the mobile follow-up composer and adaptive polling

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/api-client.js`
- Modify: `public/styles.css`
- Create: `test/frontend-control.test.mjs`
- Modify: `test/frontend-layout.test.mjs`
- Modify: `test/frontend-refresh-state.test.mjs`

- [ ] **Step 1: Add failing frontend tests**

Use the existing fake DOM pattern to cover capability discovery, token dialog/unlock, `sessionStorage` only, no token persistence after failed verification, Codex/idle eligibility, busy/unknown disabling, 16 KiB validation, authenticated POST, active run persistence, run failure display, one-second active polling, restoration to eight seconds, and scroll/disclosure preservation.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test test/frontend-control.test.mjs test/frontend-layout.test.mjs test/frontend-refresh-state.test.mjs`

Expected: composer elements and control requests are absent.

- [ ] **Step 3: Implement the composer and token dialog**

Add an unframed composer below the timeline, a native dialog for token entry, compact inline status, and a plain `Send` button. Store `glassline.controlToken` and active run IDs in `sessionStorage`. Clear prompt text only after `202`; never inject optimistic timeline messages.

- [ ] **Step 4: Replace the fixed interval with adaptive scheduling**

Use one self-scheduling timeout: 1000 ms while an active run or selected `turnState === "running"`, otherwise 8000 ms. Poll the run resource and existing sessions/timeline without changing the current history-reading, `New content`, disclosure, or scroll behavior.

- [ ] **Step 5: Implement mobile layout constraints**

Keep `.detail-pane` bounded to the viewport, timeline independently scrollable, and composer outside the timeline scroll region with `padding-bottom: env(safe-area-inset-bottom)`. Keep status height stable and ensure the raw tab hides the composer.

- [ ] **Step 6: Run frontend tests**

Run: `node --test test/frontend-control.test.mjs test/frontend-layout.test.mjs test/frontend-refresh-state.test.mjs`

Expected: all frontend control and regression tests pass.

### Task 5: Wire launchd and public documentation

**Files:**
- Modify: `scripts/launchd-utils.mjs`
- Modify: `scripts/install-launchd.mjs`
- Modify: `test/launchd-utils.test.mjs`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `CONTRIBUTING.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Add failing launchd tests**

Assert optional `GLASSLINE_CONTROL_TOKEN` and absolute `GLASSLINE_CODEX_BIN` are XML escaped and present only when configured. Assert install writes the plist with mode `0o600` when a token is copied.

- [ ] **Step 2: Implement launchd environment propagation**

Resolve Codex from the installer's PATH, accept an explicit absolute `GLASSLINE_CODEX_BIN`, pass optional control values to `buildLaunchdPlist`, and use `writeFile(..., { encoding: "utf8", mode: 0o600 })` when control is enabled. Never print the token.

- [ ] **Step 3: Update public and agent documentation**

Document opt-in token generation, current-browser storage, Cloudflare Access requirement, Codex-only follow-up, auto-review behavior, inherited sandbox, launchd plaintext local storage, API routes, adaptive polling, and continuing non-goals. Replace unconditional read-only wording with “read-only by default, with one opt-in Codex follow-up capability.” Keep relay architecture-neutral.

- [ ] **Step 4: Run launchd and documentation checks**

Run: `node --test test/launchd-utils.test.mjs`

Run: `git diff --check`

Expected: tests pass and no whitespace errors are reported.

### Task 6: Full verification and local smoke

**Files:**
- Modify only files needed to correct failures found by verification.

- [ ] **Step 1: Run the full release gate**

Run: `npm run release-check`

Expected: all tests pass with no skipped/todo tests; the history scan reports only exact baseline waivers.

- [ ] **Step 2: Inspect the npm package**

Run: `npm pack --dry-run --json`

Expected: the control modules, public assets, documentation, and synthetic tests are listed; no real transcript, token, user path, or generated tarball is included.

- [ ] **Step 3: Run synthetic HTTP/CLI smoke tests**

Start Glassline with a synthetic Codex home, a generated 32+ character token, and a fake Codex executable. Verify allowed Host reads, unauthorized write rejection, idle `202`, duplicate `409`, run completion, timeline refresh, and malicious Host `403`. Do not invoke the user's real Codex session.

- [ ] **Step 4: Inspect final repository state**

Run: `git diff --check`

Run: `git status --short`

Expected: only planned implementation, test, documentation, specification, and plan changes remain. Do not tag, release, publish, or push.
