# Launchd Control Environment Design

## Summary

The macOS launchd installer will persist optional `GLASSLINE_ALLOWED_HOSTS` and `GLASSLINE_CONTROL_TOKEN` values supplied to `npm run install-launchd`. The LaunchAgent will continue binding to `127.0.0.1`; the Host allowlist changes accepted HTTP Host headers only.

## Behavior

- When `GLASSLINE_ALLOWED_HOSTS` is set, the installer validates it with the same parser used by server startup and writes the original comma-separated value into the plist.
- When it is absent or empty, the plist omits the key and Glassline keeps its loopback-only default allowlist.
- Existing `GLASSLINE_CONTROL_TOKEN` validation, Codex binary resolution, XML escaping, and explicit plist mode `0600` remain unchanged.
- Invalid allowlist configuration stops installation before the plist is written or the service is bootstrapped.
- `HOST` remains fixed at `127.0.0.1`, which is appropriate for a local Cloudflare Tunnel origin.

## Testing and Documentation

Launchd plist tests will cover the optional allowlist entry, omission by default, and XML-safe output alongside the existing token assertions. README and `AGENTS.md` will document the combined installer command and the distinction between binding, Host validation, and authentication.
