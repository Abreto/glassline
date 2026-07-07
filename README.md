# Glassline

Glassline is a read-only local AI agent session viewer. It gives a browser UI for watching local agent state, transcript fragments, command output, file-change summaries, and raw source data without sending prompts or controlling the running agent.

## Run

```sh
npm start
```

Then open `http://127.0.0.1:6280`.

The MVP has no runtime npm dependencies. It includes a mock provider so the UI has sample data immediately. Disable that sample data with:

```sh
GLASSLINE_MOCK=0 npm start
```

Runtime options:

- `PORT`: HTTP port, default `6280`.
- `HOST`: bind host, default `127.0.0.1`.
- `GLASSLINE_MOCK=0`: hide sample provider data.
- `CODEX_HOME`: override the Codex data directory, default `~/.codex`.

## Test

```sh
npm test
```

## Internal MVP Release Check

Before sharing an internal build:

1. Run `npm test`.
2. Run `GLASSLINE_MOCK=0 PORT=6281 CODEX_HOME=test/fixtures/codex-home npm start`.
3. Check `http://127.0.0.1:6281/api/providers`, `/api/sessions`, and `/`.
4. Confirm helper processes such as Codex Computer Use are not listed as sessions.
5. Stop the local server after the smoke check.

## Current Provider Behavior

- `mock`: sample complete session for UI development.
- `codex`: best-effort process discovery plus best-effort session-file parsing from `CODEX_HOME || ~/.codex`. Session-file entries are marked `partial`; process-only entries remain `process-only`.
- `claude-code`: best-effort process discovery. Sessions are marked `process-only`.

Private provider session files and logs are intentionally not treated as stable APIs. Future adapters should keep parser-specific uncertainty inside the provider layer and surface `SourceRef` entries with explicit confidence on sessions, turns, and timeline items.

Codex session-file support reads `session_index.jsonl` and `sessions/**/*.jsonl`. List responses use lightweight summaries; detail and raw endpoints read the full JSONL on demand.

Known MVP limits:

- Provider data is read-only and best-effort; private provider files are not stable APIs.
- Codex session-file status is usually `unknown` unless a matching running process is found.
- Claude Code support is process-only in this MVP.
- The app is intended for local use on `127.0.0.1`, not as a shared network service.

## Provider Contract

The TypeScript interface lives in `src/core/provider.ts`.

At runtime, a provider adapter exposes:

```ts
interface ProviderAdapter {
  id: string;
  displayName: string;
  listSessions(): Promise<Session[]>;
  getSession?(id: string): Promise<Session | null>;
  getRawSession?(id: string): Promise<RawSession | null>;
}
```

The core registry in `src/core/session-registry.mjs` normalizes provider output, sorts sessions by `lastUpdatedAt`, and falls back to JSON raw output when a provider does not expose raw source text.

## API

- `GET /api/providers`
- `GET /api/sessions`
- `GET /api/sessions/:id`
- `GET /api/raw/:id`
