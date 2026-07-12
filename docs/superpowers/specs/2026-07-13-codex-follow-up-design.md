# Codex Follow-up Design

## Summary

Glassline will add one deliberately narrow control capability: an authenticated device may send a plain-text follow-up prompt to an existing, idle Codex session. Glassline delegates the turn to the official Codex CLI with `codex exec resume`; it does not implement an agent runtime, create sessions, expose a shell, surface manual approvals, interrupt turns, or queue prompts.

The feature is opt-in. Without `GLASSLINE_CONTROL_TOKEN`, Glassline remains read-only and does not expose a follow-up POST route. Remote use still requires Cloudflare Access or an equivalent authenticated reverse proxy; the control token is a second, architecture-neutral authorization boundary rather than a replacement for external authentication.

## Product Behavior

- V1 supports only session-file-backed Codex sessions with a reliable UUID and an existing project directory.
- The composer accepts plain text only, with a UTF-8 limit of 16 KiB. It does not accept images, files, slash commands, approval overrides, or shell input. Mobile operating-system dictation remains usable through the normal text field.
- Follow-up is available only when the latest Codex lifecycle event proves the turn is idle. A final `task_started` means running; `task_complete` or `turn_aborted` means idle; missing or malformed lifecycle data means unknown and fails closed.
- A live Codex process is not itself evidence that a turn is running. An idle interactive CLI may remain attached to the session.
- Only one Glassline-started run may exist per session. A busy or unknown session returns a conflict; V1 does not queue or interrupt.
- After submission, the UI disables the composer and polls once per second. It restores the normal eight-second refresh after the run completes or fails.
- Timeline data continues to come only from the official Codex session JSONL. The CLI JSON stream reports execution state but is not inserted as a second transcript source.
- Reading older timeline pages remains undisturbed. New items use the existing `New content` path instead of forcing the reader to the latest item.

## Security Model

- `GLASSLINE_CONTROL_TOKEN` enables control and must contain at least 32 non-control characters with no leading or trailing whitespace. Invalid configuration exits at startup with a single-line error. Documentation recommends `openssl rand -base64 32`.
- The browser submits the token as `Authorization: Bearer <token>`. The server compares UTF-8 bytes with `crypto.timingSafeEqual`, never logs or echoes the token, and rejects authentication before session lookup or process creation.
- The browser stores a verified token only in `sessionStorage`. Closing the browser session removes it. Existing CSP, escaped transcript rendering, same-origin resource policy, and the absence of CORS remain defense in depth against token disclosure and cross-origin writes.
- Host validation runs before body parsing and authentication. All control responses retain the shared browser security headers and `Cache-Control: no-store`.
- A non-loopback deployment still requires Cloudflare Access or an equivalent authenticated proxy. `GLASSLINE_ALLOWED_HOSTS` remains only a Host allowlist.
- Glassline invokes Codex with `approval_policy="on-request"` and `approvals_reviewer="auto_review"`. It never uses `approval_policy="never"` or `--dangerously-bypass-approvals-and-sandbox`.
- Glassline does not override sandbox mode, writable roots, network policy, rules, model, or other user/project Codex configuration. Auto-review changes the reviewer, not the permission boundary. A denial or reviewer failure fails the run and is not manually overridable from Glassline in V1.

## Architecture

Control remains separate from the read-only provider contract:

```text
ProviderAdapter                 CodexFollowUpController
list/read session data          authorize, validate, and spawn one turn
```

The Codex session parser adds `turnState: "running" | "idle" | "unknown"` to `Session`. It derives the state conservatively from valid JSONL records and does not change the existing process-based `Session.status` meaning.

The controller owns an in-memory map of active and recently completed runs. It re-reads the selected session after acquiring a per-session lock so two simultaneous POST requests cannot both pass the idle check. Completed records contain only run ID, session ID, status, timestamps, and a bounded sanitized error; prompts and CLI event streams are not retained. Records expire after ten minutes and the map is capped at 100 entries.

The child process is spawned without a shell using the equivalent of:

```sh
codex exec resume \
  --json \
  -c 'approval_policy="on-request"' \
  -c 'approvals_reviewer="auto_review"' \
  <SESSION_UUID> -
```

The prompt is written to stdin and the process cwd is the session `projectPath`. The controller parses stdout as bounded JSONL and recognizes `turn.completed`, `turn.failed`, and `error`; it retains at most 8 KiB of sanitized stderr/error detail. The active lock is released on completion, nonzero exit, spawn error, or stream failure. A successful `spawn` event is required before the HTTP request returns `202`.

`GLASSLINE_CODEX_BIN` optionally selects an absolute executable. Otherwise startup resolves `codex` from `PATH` without invoking a shell. When control is enabled, failure to resolve an executable is a startup configuration error. The launchd installer resolves the current Codex executable and writes its absolute path into the plist. If it copies `GLASSLINE_CONTROL_TOKEN`, the plist is written with mode `0600`, and the documentation warns that the token is stored there for the local user.

## HTTP Interface

`GET /api/control` discovers and validates control:

- With control disabled: `200 {"followUp":{"enabled":false,"authorized":false,"providers":[]}}`.
- With control enabled and no token: `200 {"followUp":{"enabled":true,"authorized":false,"providers":["codex"]}}`.
- With a valid token: the same response with `authorized:true`.
- With a malformed or invalid Authorization header: `401 {"error":"Invalid control token"}`.

`POST /api/sessions/:id/follow-up` accepts an `application/json` body capped at 20 KiB with exactly one required field, `prompt`. The prompt itself is capped at 16 KiB of UTF-8 text; unknown fields are ignored. It returns:

- `202 {"runId":"<random-id>","sessionId":"<id>","status":"running"}` after the child spawns.
- `400` for malformed JSON, unsupported content type, empty text, or invalid UTF-8 input.
- `401` for a missing or invalid token while control is enabled.
- `404` when control is disabled or the session does not exist.
- `409` for running, unknown, or already locked sessions.
- `413` when the request body exceeds 20 KiB or the prompt exceeds 16 KiB.
- `422` for sessions that are not eligible Codex session-file sessions.
- `503` when cwd or the Codex execution environment is unavailable.

`GET /api/control/runs/:runId` requires the same Bearer token and returns `running`, `complete`, or `failed`, plus a bounded error only for failed runs. It returns `404` after expiry or server restart. The browser stores the active run ID in `sessionStorage`; if it disappears, the UI falls back to the session `turnState` and normal timeline refresh.

All other non-GET routes continue to return `405`. Rejected Host requests do not parse JSON, compare tokens, read providers, or spawn processes.

## Frontend

- The session detail view gains an unframed composer below the timeline, with a stable text area and Send command. It is shown only when server capabilities enable Codex follow-up and the selected session is eligible.
- An unlock action opens a small token dialog. The UI verifies the token through `GET /api/control`, then stores it in `sessionStorage`. Invalid tokens remain out of storage and produce an inline error.
- The Send action is disabled for empty prompts, non-idle sessions, unavailable cwd/CLI state, and active submissions. It immediately clears the text only after a `202` response.
- While active, the UI polls both the run resource and the existing session/timeline endpoints once per second. It shows compact running or failure state near the composer without synthesizing transcript messages.
- Completion returns polling to eight seconds. Background refresh, disclosure state, pagination, `New content`, and scroll preservation retain their existing behavior.
- The composer must remain usable above the mobile safe area and virtual keyboard and must not resize the timeline when its status text changes.

## Documentation And Boundaries

README, SECURITY.md, CONTRIBUTING.md, and AGENTS.md will describe the new opt-in control boundary, token generation, launchd storage, Cloudflare Access requirement, and Codex-only limitation. The Roadmap will move existing-session Codex follow-up into the current phase while leaving relay topology architecture-neutral.

Continuing non-goals are new-session creation, Claude control, prompt queues, turn interruption, manual approval, process termination, arbitrary commands, shell/PTY access, unrestricted WebSockets, and built-in remote identity infrastructure.

## Testing And Acceptance

- Parser fixtures cover lifecycle ordering, malformed lines, aborted turns, missing lifecycle records, and the distinction between process status and turn state.
- Auth tests cover disabled control, valid/invalid/malformed Bearer headers, minimum token validation, timing-safe comparison behavior, and rejection before provider/process access.
- HTTP tests cover all response codes, security headers, content type, request-size enforcement, unknown fields, and one-spawn behavior under concurrent requests.
- Controller tests use a synthetic executable to assert exact argv, cwd, stdin prompt transfer, no shell, inherited environment/config, JSONL completion/failure, bounded errors, lock release, expiry, and the absence of retained prompt text.
- Frontend tests cover token storage scope, unlock/error states, eligibility, disabled sending, `202` handling, one-second active polling, run failures, return to eight-second polling, and preservation of timeline scroll/disclosures.
- launchd tests cover Codex binary resolution, optional token propagation, XML escaping, and plist mode `0600` when control is configured.
- `npm run release-check` must pass with no skipped/todo tests. Fixture smoke tests must prove unauthorized writes fail, busy sessions return `409`, an idle synthetic Codex session accepts one prompt, and no tag, release, publish, relay, or authentication service is introduced.

## References

- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex Auto-review](https://learn.chatgpt.com/docs/sandboxing/auto-review)
