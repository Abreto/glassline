# Glassline

[![CI](https://github.com/Abreto/glassline/actions/workflows/ci.yml/badge.svg)](https://github.com/Abreto/glassline/actions/workflows/ci.yml)

Glassline is a local AI agent session viewer that is read-only by default. It provides a browser UI for watching local agent sessions, transcript fragments, command output, file-change summaries, and raw source data. An explicitly enabled control mode can send a plain-text follow-up to an existing idle Codex session through the official Codex CLI.

## Why Glassline

I built Glassline because I wanted a convenient, mobile-friendly way to follow the progress and results of running agents, and I could not find an existing open-source tool that fit this workflow well.

When I am at my computer, I prefer to work through the provider's official CLI or desktop client. I do not want Glassline to become another execution layer between me and the agent. Glassline therefore remains read-only by default and delegates its one opt-in follow-up action to the official Codex CLI.

Any additional remote control must remain deliberately narrow and available only to authenticated devices. Actions should be delegated to the provider's official CLI or client rather than executed by a separate agent runtime maintained by Glassline.

## Security and privacy

Agent transcripts and raw provider records can contain source code, local paths, command output, access tokens, or other secrets. Glassline has no built-in user authentication and is designed to bind to `127.0.0.1` by default.

Do not expose Glassline directly to a LAN or the public internet. If you use a tunnel or reverse proxy, protect it with authentication such as Cloudflare Access and explicitly allow the proxy hostname with `GLASSLINE_ALLOWED_HOSTS`.

`GLASSLINE_ALLOWED_HOSTS` only validates HTTP Host headers. It does not change the bind address, encrypt traffic, or add authentication.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Requirements and platform support

- Node.js 20 or newer.
- macOS is the primary supported platform.
- Linux is best-effort; the process adapters require a compatible `ps` implementation.
- Windows is not currently supported.

Glassline has no runtime npm dependencies.

## Run from a checkout

Clone the repository and start Glassline from the checkout:

```sh
git clone https://github.com/Abreto/glassline.git
cd glassline
npm start
```

Open `http://127.0.0.1:6280`.

A synthetic mock session is enabled by default so the UI has sample data immediately. Hide it with:

```sh
GLASSLINE_MOCK=0 npm start
```

Runtime options:

- `PORT`: HTTP port, default `6280`.
- `HOST`: bind host, default `127.0.0.1`.
- `GLASSLINE_ALLOWED_HOSTS`: comma-separated additional hostnames or IP addresses accepted in HTTP Host headers. Entries are exact, omit ports, and do not support wildcards.
- `GLASSLINE_MOCK=0`: hide sample provider data.
- `CODEX_HOME`: override the Codex data directory, default `~/.codex`.
- `GLASSLINE_CONTROL_TOKEN`: enable authenticated Codex follow-up; must contain at least 32 characters.
- `GLASSLINE_CODEX_BIN`: absolute Codex executable path. When omitted, Glassline resolves `codex` from `PATH`.

Loopback hosts (`localhost`, `127.0.0.1`, and `::1`) are always accepted. A custom reverse-proxy hostname can be added without changing the default bind address:

```sh
GLASSLINE_ALLOWED_HOSTS=glassline.example.com npm start
```

Binding beyond loopback is an explicit trust-boundary change and prints a startup warning. LAN access also needs the address used by the browser in the Host allowlist:

```sh
HOST=0.0.0.0 GLASSLINE_ALLOWED_HOSTS=192.168.1.10 npm start
```

This example is not an authenticated deployment model.

## Opt-in Codex follow-up

Without `GLASSLINE_CONTROL_TOKEN`, Glassline exposes no write API and remains read-only. Generate a high-entropy token, keep it outside the repository, and start Glassline with control enabled:

```sh
openssl rand -base64 32
GLASSLINE_CONTROL_TOKEN='<generated-token>' GLASSLINE_MOCK=0 npm start
```

The browser asks for this token before enabling the composer and stores it only in the current browser `sessionStorage`. Closing that browser session removes it. For non-loopback access, the token is a second authorization boundary; Cloudflare Access or an equivalent authenticated reverse proxy is still required.

V1 control is deliberately narrow:

- It sends plain-text follow-up prompts only to existing, idle Codex session-file sessions.
- It delegates execution to `codex exec resume` and does not implement an agent runtime.
- It uses Codex `on-request` approvals with Auto-review and inherits the current Codex sandbox, writable roots, network policy, rules, and project configuration.
- It does not create sessions, queue or interrupt turns, expose manual approvals, accept attachments, terminate processes, or provide shell/PTY access.

## macOS persistent local service

Install a user-level `launchd` service from the current checkout:

```sh
npm run install-launchd
```

To persist a reverse-proxy hostname and opt into follow-up for the LaunchAgent, pass both values while installing:

```sh
GLASSLINE_ALLOWED_HOSTS=glassline.example.com \
GLASSLINE_CONTROL_TOKEN='<generated-token>' \
npm run install-launchd
```

Either variable can be supplied independently. The installer validates `GLASSLINE_ALLOWED_HOSTS`, resolves the current Codex executable when control is enabled, and stores the configured values in the user LaunchAgent plist. A plist containing the token is explicitly set to mode `0600`. The token is still plaintext local-user configuration; reinstall the service to rotate or remove it.

The installer keeps `HOST=127.0.0.1`. `GLASSLINE_ALLOWED_HOSTS` changes only accepted HTTP Host headers, so a local Cloudflare Tunnel can reach Glassline without exposing the listener to the LAN.

The LaunchAgent does not require `sudo`. It runs the current repository with the Node executable used by npm and sets:

- `HOST=127.0.0.1`
- `PORT=6280`
- `GLASSLINE_MOCK=0`

It also copies optional `GLASSLINE_ALLOWED_HOSTS`, `GLASSLINE_CONTROL_TOKEN`, and the resolved `GLASSLINE_CODEX_BIN` from the installation environment.

Check service state:

```sh
launchctl print gui/$UID/com.glassline.local
```

Logs are retained at `~/Library/Logs/glassline/stdout.log` and `~/Library/Logs/glassline/stderr.log`.

Uninstall the service with:

```sh
npm run uninstall-launchd
```

Uninstalling stops the LaunchAgent and removes its plist while retaining logs for troubleshooting. The scripts do not install or manage Cloudflare Tunnel.

## Personal remote access today

Glassline does not currently include a remote service or authentication layer. For personal remote access, run Glassline on loopback and place a user-managed Cloudflare Tunnel behind Cloudflare Access or an equivalent authenticated reverse proxy.

Allow the public hostname without changing the loopback bind address:

```sh
GLASSLINE_ALLOWED_HOSTS=glassline.example.com GLASSLINE_MOCK=0 npm start
```

Configure and operate the tunnel, identity policy, TLS, and access logs outside Glassline. Do not expose the local HTTP server directly or treat `GLASSLINE_ALLOWED_HOSTS` as authentication.

## Provider behavior

- `mock`: a complete synthetic session for UI development.
- `codex`: best-effort process discovery plus best-effort session-file parsing from `CODEX_HOME || ~/.codex`. Session-file entries are normally `partial`; unmatched live processes remain `process-only`.
- `claude-code`: best-effort process discovery only; sessions are `process-only`.

Private provider files are not stable APIs. Missing, malformed, or stale data is handled conservatively and surfaced with `SourceRef` and explicit quality metadata.

Known limits:

- Codex session-file status is usually `unknown` unless it can be matched to a running process.
- Claude Code has no transcript parser yet.
- There is no built-in user authentication, remote deployment model, new-session input, manual approve/deny action, process control, arbitrary command execution, or web shell.

## Roadmap

The roadmap is directional rather than a compatibility or delivery commitment. Glassline will keep the implementation architecture neutral until each phase has a separate product and security design.

### Now

- Keep the local viewer read-only by default, local-first, and useful without hosted infrastructure.
- Support one opt-in, token-protected Codex follow-up action for existing idle sessions through the official CLI.
- Improve provider coverage, parser resilience, timeline fidelity, and self-hosting ergonomics.
- Support personal remote viewing through an external authenticated layer such as Cloudflare Tunnel plus Cloudflare Access.

### Later

- Explore an optional relay for authenticated devices so users can view local sessions without directly exposing the local server. The relay protocol, topology, hosting model, and trust boundaries are intentionally unspecified for now.
- Consider any additional remote-control actions for authenticated devices only after an explicit authorization model, audit trail, revocation design, conservative defaults, and a separate security review.

### Continuing non-goals

- Unauthenticated public access or a shared multi-user deployment by default.
- A general-purpose web shell, arbitrary command input, raw PTY access, or an unrestricted WebSocket terminal.
- Expanding remote control implicitly as part of provider parsing or read-only viewing work.

## Provider contract

The TypeScript model lives in `src/core/provider.ts`. At runtime an adapter exposes:

```ts
interface ProviderAdapter {
  id: string;
  displayName: string;
  listSessions(): Promise<Session[]>;
  getSession?(id: string): Promise<Session | null>;
  getSessionTimelinePage?(
    id: string,
    options?: TimelinePageOptions
  ): Promise<TimelinePage | null>;
  getRawSession?(id: string): Promise<RawSession | null>;
}
```

The core registry normalizes provider output, sorts sessions by `lastUpdatedAt`, paginates fallback timelines, and falls back to JSON when an adapter does not expose raw source text.

## HTTP API

- `GET /api/providers`
- `GET /api/sessions`
- `GET /api/sessions/:id`
- `GET /api/sessions/:id/timeline?limit=80&cursor=<cursor>`
- `GET /api/raw/:id`
- `GET /api/control`
- `POST /api/sessions/:id/follow-up`
- `GET /api/control/runs/:runId`

The timeline endpoint returns the newest page first. `nextCursor` requests an older page, and page limits are capped at 200 items.

Control routes are available only when `GLASSLINE_CONTROL_TOKEN` is configured. POST and run-status requests require the token as a Bearer credential. Follow-up accepts a JSON body containing a plain-text `prompt`; successful submission returns `202` with a run ID.

## Development and pre-public checks

Run the test suite:

```sh
npm test
```

Scan every reachable Git blob for common secrets and non-placeholder home paths:

```sh
npm run check:sensitive-history
```

Run both checks in sequence:

```sh
npm run release-check
```

Before making a repository public:

1. Fetch the complete Git history and run `npm run release-check`.
2. Run `npm pack --dry-run --json` and inspect the file list.
3. Start the fixture server with `GLASSLINE_MOCK=0 PORT=6281 CODEX_HOME=test/fixtures/codex-home npm start`.
4. Check `/`, `/api/providers`, `/api/sessions`, and a timeline page from an allowed Host.
5. Confirm an unapproved Host receives `403` before provider discovery.
6. Confirm helper processes such as Codex Computer Use are not listed as sessions.
7. Enable GitHub Private Vulnerability Reporting before public access.

See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
