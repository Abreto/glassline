# Glassline Agent Handoff

This document records the current project state for future coding agents. It is not user-facing marketing documentation. Its primary purpose is to help future changes preserve Glassline's product boundaries, architectural constraints, and testing practices.

## Product Boundaries

- Glassline is a read-only-by-default local AI agent session viewer. It provides a browser interface for inspecting local agent sessions, transcripts, command output, file changes, and raw source data.
- The shipped product has one explicit opt-in control path: a bearer-token-protected plain-text follow-up for an existing idle Codex session, delegated to `codex exec resume`. It does not create sessions, queue or interrupt turns, or implement an agent runtime.
- Any additional control action requires a separate product and security design defining authorization, auditability, revocation, and conservative defaults. Do not introduce controls as an incidental extension of viewing or provider work.
- A general-purpose web shell, arbitrary command input, raw PTY access, and an unrestricted WebSocket terminal remain outside the product boundary.
- The service is local by default: `HOST` defaults to `127.0.0.1`. Setting `HOST=0.0.0.0` for phone testing exposes Glassline to the local network and does not represent the product's default security model.
- HTTP Host validation allows only `localhost`, `127.0.0.1`, and `::1` by default. Reverse-proxy or LAN access must explicitly add exact hostnames or IP addresses through `GLASSLINE_ALLOWED_HOSTS`. This allowlist is not authentication; non-loopback access still requires external authentication.
- The current personal remote-access model is a user-managed Cloudflare Tunnel behind Cloudflare Access or an equivalent authenticated reverse proxy. Glassline does not install, configure, or operate that layer.
- `GLASSLINE_CONTROL_TOKEN` is a second authorization boundary for writes, not identity authentication and not a replacement for the external access layer. The launchd installer may store it in the user plist with mode `0600`.
- A future relay is a roadmap direction only. Keep its protocol, topology, hosting model, and trust boundaries architecture-neutral until a dedicated design is approved.
- Treat private provider files as best-effort data sources, never as stable APIs. Handle parse failures, missing fields, and stale indexes conservatively.
- Session and timeline data should carry `SourceRef` metadata wherever possible and must use `quality` to communicate data quality: `complete`, `partial`, `process-only`, or `stale`.

## Current Architecture

- The runtime is a Node.js built-in HTTP server with no runtime npm dependencies. `package.json` includes these scripts:
  - `npm start` -> `node src/server.mjs`
  - `npm test` -> `node --test`
  - `npm run install-launchd` / `npm run uninstall-launchd` -> install or remove the macOS user LaunchAgent.
  - `npm run check:sensitive-history` -> scan all reachable Git blobs for common credentials and local paths, then apply the exact-match baseline.
  - `npm run release-check` -> run the tests and sensitive-history scan sequentially.
- `src/server.mjs` loads environment configuration, assembles providers, and starts the HTTP server.
- `src/http-app.mjs` implements the static-file and JSON API request handler. Read routes accept `GET`; the single follow-up route accepts `POST`; all other method/path combinations return `404` or `405`. It applies the shared security headers to every response.
- `src/http-security.mjs` parses `GLASSLINE_ALLOWED_HOSTS`, validates HTTP Host headers, and defines browser security headers.
- `src/server-listen.mjs` handles server listening and friendly errors such as `EADDRINUSE` and `EPERM`.
- `src/control/control-auth.mjs` validates opt-in control configuration, performs constant-time Bearer checks, and resolves the Codex executable without a shell.
- `src/control/codex-follow-up.mjs` owns per-session run locks and a bounded 100-record run map, then delegates one turn to `codex exec resume --json`; it is intentionally separate from the read-only provider contract.
- `src/core/provider.ts` defines the core models: `ProviderAdapter`, `Session`, `Turn`, `TimelinePage`, `TimelineItem`, `Message`, `CommandRun`, `ToolCall`, `FileChange`, `Status`, `SourceRef`, and `ResumeRef`.
- `src/core/session-registry.mjs` aggregates providers, normalizes data, sorts by descending `lastUpdatedAt`, normalizes `resumeRef`, provides timeline-page and raw-data fallbacks, and creates adapter-error sessions.
- Provider adapters live in `src/providers/`:
  - `mock.mjs`: UI and demo data; enabled by default.
  - `codex.mjs`: combines Codex process discovery with the session-file adapter.
  - `codex-session-file.mjs`: reads and parses Codex JSONL under `CODEX_HOME || ~/.codex`.
  - `claude-code.mjs`: process-only Claude Code discovery.
  - `process-utils.mjs`: `ps` process discovery, command tokenization, and process-only session construction.
- The frontend uses browser-native static modules with no React, Vite, or Tailwind:
  - `public/app.js`: application state, API requests, session selection, timeline/raw rendering, and the copy registry.
  - `public/api-client.js`: `requestJson()` and error state.
  - `public/control-client.js`: follow-up eligibility, prompt validation, authenticated request options, and adaptive polling intervals.
  - `public/timeline-renderers.js`: timeline grouping, safe Markdown, activity groups, and collapsed output.
  - `public/session-renderers.js`: small session and resume UI components.
  - `public/styles.css`: mobile-first styling and the dual-scroll-region layout.

## Runtime, Environment Variables, and API

- Start locally with:
  ```sh
  npm start
  ```
- Default URL: `http://127.0.0.1:6280`
- Common environment variables:
  - `PORT`: HTTP port; defaults to `6280`.
  - `HOST`: bind host; defaults to `127.0.0.1`.
  - `GLASSLINE_ALLOWED_HOSTS`: comma-separated additional HTTP Host hostnames or IP addresses. Matching is exact and ignores the request port. Schemes, paths, userinfo, ports, and wildcards are not allowed in entries.
  - `GLASSLINE_MOCK=0`: hide the mock provider.
  - `CODEX_HOME`: override the Codex data directory; defaults to `~/.codex`.
  - `GLASSLINE_CONTROL_TOKEN`: opt into existing-session Codex follow-up; minimum 32 characters.
  - `GLASSLINE_CODEX_BIN`: absolute Codex executable path; otherwise resolved from `PATH` when control is enabled.
- Internal smoke-test example:
  ```sh
  GLASSLINE_MOCK=0 PORT=6281 CODEX_HOME=test/fixtures/codex-home npm start
  ```
- HTTP API:
  - `GET /api/providers`
  - `GET /api/sessions`
  - `GET /api/sessions/:id`
  - `GET /api/sessions/:id/timeline?limit=80&cursor=<cursor>`: returns the newest timeline page. Supplying `cursor` requests an older page. The current cursor is the starting index of the preceding window, encoded as a string.
  - `GET /api/raw/:id`
  - `GET /api/control`
  - `POST /api/sessions/:id/follow-up`
  - `GET /api/control/runs/:runId`

## Current Provider Behavior

- `mock`
  - Returns one complete demo session for local UI development.
  - Disable it with `GLASSLINE_MOCK=0`.
- `codex`
  - Process discovery runs `ps -axo pid=,lstart=,command=`, matches `codex` and `codex-cli`, and excludes non-user-session processes such as app helpers, daemons, Crashpad, and Codex Computer Use.
  - Session-file discovery reads `session_index.jsonl` and `sessions/**/*.jsonl`.
  - List mode uses lightweight summaries. Session details, timeline pages, and raw data load the complete JSONL on demand.
  - Session titles must remain short. Prefer a cleaned `thread_name`. If it is missing or too long, detailed parsing derives a title from the first meaningful user request. Final titles are limited to 96 characters; never use a full transcript or prompt blob as a title.
  - Session-file IDs have the form `codex:session-file:<uuid>` and normally use `partial` quality.
  - Process-only IDs have the form `codex:process:<pid>` and use `process-only` quality.
  - When a session ID can be determined, merge process sources into the matching session-file session and mark it `running`. When the ID cannot be determined, keep a process-only session; do not guess from cwd or time windows.
  - Important `lastUpdatedAt` rules: full parsing uses the newer of index `updated_at` and the newest JSONL event time; summary mode uses the newer of the index time and file mtime; when multiple rollout files share a session ID, keep the newest file.
  - `resumeRef` exposes commands in the form `codex resume <uuid>`. Copy actions copy only the raw provider argument.
  - `turnState` is derived independently from the latest valid `task_started`, `task_complete`, or `turn_aborted` event. Process liveness must not be used as turn-busy state.
  - Follow-up invokes `codex exec resume <uuid> - --json` without a shell, writes the prompt through stdin, uses `approval_policy=on-request` plus `approvals_reviewer=auto_review`, and does not override the user's Codex sandbox or project configuration.
- `claude-code`
  - Currently performs process discovery only and returns `process-only` sessions.
  - Extracts `resumeRef` from `-r`, `--resume`, and `--session-id`. Commands use the form `claude -r <value>`.
- `tmux`
  - `SourceKind` already includes `tmux`, but there is no tmux adapter or web shell.
  - If added later, prefer a read-only `tmux capture-pane` view. An interactive terminal would change the product boundary.

## Current Frontend Behavior

- The session list is sorted by descending backend `lastUpdatedAt` and refreshes every 8 seconds.
- While a selected turn or Glassline-submitted follow-up is running, the frontend polls once per second and returns to the normal 8-second interval afterward.
- Opening or switching sessions loads only the newest timeline page, currently 80 items, and focuses the newest message. Older pages load only when the user scrolls near the top of the timeline.
- Background refreshes do not force scrolling. If the user is not near the timeline end, preserve the currently loaded window so reading is not interrupted.
- If a background refresh finds that the selected session has content newer than the loaded tail, show a `New content` control at the end of the timeline. Clicking it, or scrolling near the bottom of the loaded window, walks backward from the newest page through `nextCursor` until it overlaps the loaded window. Replace refreshed items by ID and append unseen items so no cross-page gap is introduced.
- Refreshing the selected session preserves expanded `activity_group` elements and nested details. Switching sessions or reloading the browser resets disclosure state.
- The main layout uses independent scroll containers:
  - Desktop: `.session-list` scrolls independently on the left; `.timeline` and `.raw-view` scroll independently on the right.
  - Mobile: the session list becomes a horizontal strip above an independently scrolling vertical timeline. `body` is not the primary scroll container.
- Messages form the top-level visual spine of the timeline:
  - Each `message` is rendered independently.
  - Consecutive `command`, `tool_call`, `file_change`, and `status` items are grouped into a collapsed `activity_group` by default.
  - After a group is expanded, command output, tool input/output, and file diffs remain nested collapsible details.
- Messages use a safe Markdown subset:
  - Supports fenced code blocks, inline code, paragraphs, line breaks, lists, blockquotes, lightweight headings, bold, italic, and links.
  - Does not support raw HTML. Input is escaped before allowlisted syntax is rendered.
  - Links allow only `http:`, `https:`, and `mailto:`.
  - Copy buttons copy the original message Markdown, not rendered HTML.
- Raw view always renders escaped plaintext and never uses the Markdown renderer.
- The UI is an information-dense tool interface. Do not turn it into a marketing page, hero page, or collection of large decorative cards.

## Testing and Development Rules

- Prefer `rg` and `rg --files` for searches.
- Use `apply_patch` for manual file edits.
- `AGENTS.md` must remain tracked. Update it whenever a substantial change affects the architecture, providers, HTTP API, core models, frontend behavior, runtime options, or testing strategy so future agents do not rely on stale context.
- Do not add runtime dependencies without a clear justification and corresponding tests and documentation.
- Fixtures and mock data must be synthetic and use example paths. Never commit real transcripts, provider logs, tokens, private repository paths, or user home paths.
- `.github/workflows/ci.yml` runs tests on macOS with Node.js 20 and 22 and on Ubuntu with Node.js 20. A separate job scans the complete Git history for sensitive data.
- Preserve the read-only default and the exact existing-session Codex follow-up boundary. Roadmap references to a relay or further remote control do not authorize additional actions; each capability requires a dedicated product and security decision first.
- Provider or parser changes require focused parser/provider tests, especially for these cases:
  - A malformed line must not make the entire session disappear.
  - Missing or stale private files and indexes must degrade conservatively.
  - Source, quality, and resume metadata must not be lost.
  - Timeline-page `items`, `nextCursor`, and `hasMore` must remain stable without breaking the existing complete `GET /api/sessions/:id` response.
  - Process matchers must exclude app helpers, daemons, and crash handlers.
- Frontend renderer or layout changes require corresponding frontend tests, especially for these cases:
  - Markdown must remain safely escaped.
  - Copy text must preserve the raw source.
  - Activity groups must remain collapsed by default.
  - The initial timeline must load only the newest page. Older pages load on upward scrolling, and prepending must preserve the reader's position.
  - New content discovered while reading history must show the `New content` state. Clicking it or scrolling near the bottom must load and append the newest pages without replacing the current window.
  - Independent mobile scrolling and compact session cards must not regress.
  - Control tokens must remain in `sessionStorage`, failed authorization must not persist them, busy/unknown turns must disable sending, and active polling must preserve history reading state.
- Before committing, run:
  ```sh
  npm run release-check
  git status --short
  ```

## Known MVP Limitations

- Provider data is best-effort, especially unstable private Codex and Claude files.
- Codex session-file status is normally `unknown`; it becomes `running` only when confidently associated with a live process.
- Claude Code has no session-file or transcript parser yet.
- There is no generic `jsonl` adapter, tmux adapter, or app-server adapter.
- There is no built-in authentication, user system, relay, or remote deployment model. Personal remote access currently depends on an external authenticated reverse proxy. Do not treat the default service as a shared network application.
- There is no new-session input, manual approval action, queue, interruption, process termination, arbitrary command execution, or web shell. Existing-session Codex follow-up is the sole approved exception to the read-only default.
