# Contributing to Glassline

Thanks for helping improve Glassline. The project is intentionally a read-only local viewer, and contributions should preserve that boundary.

## Development setup

Glassline requires Node.js 20 or newer and has no runtime npm dependencies. From an existing checkout:

```sh
npm test
npm start
```

Before submitting a change, run:

```sh
npm run release-check
git status --short
```

## Product and architecture boundaries

- Do not add prompt submission, process control, approve/deny actions, command input, PTY access, an interactive shell, or a WebSocket terminal without an explicit product decision.
- Treat private provider files as best-effort inputs, not stable APIs. Preserve `SourceRef`, `quality`, and resume metadata when data is partial or stale.
- Do not add runtime dependencies without a clear need and corresponding documentation and tests.
- Keep the default service loopback-only. Network exposure requires an explicit Host allowlist and external authentication.

## Tests and fixtures

- Provider and parser changes need focused tests for malformed or stale input and source metadata preservation.
- Frontend renderer and layout changes need tests for safe escaping, raw copy text, disclosure state, timeline pagination, and independent mobile scrolling.
- Fixtures must be synthetic. Never commit a real transcript, provider log, home directory, access token, customer name, or private repository path.
- Update `AGENTS.md` when changing the architecture, provider behavior, API, runtime options, frontend behavior, or test strategy.

Security issues and sensitive samples do not belong in public issues. Follow `SECURITY.md` instead.
