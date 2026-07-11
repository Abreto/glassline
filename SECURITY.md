# Security Policy

## Supported versions

Glassline is pre-1.0. Only the current `main` branch is supported with security fixes.

## Reporting a vulnerability

Use GitHub Private Vulnerability Reporting from the repository's **Security** tab. Repository maintainers must enable that feature before making the repository public.

Do not open a public issue containing a real transcript, raw provider record, access token, private path, command output, or file diff. Reduce reproductions to synthetic data before sharing them.

The project does not promise a fixed response SLA. Reports will be evaluated according to impact, reproducibility, and the local-only security model.

## Local security model

Glassline reads sensitive local agent data and has no built-in authentication. It binds to `127.0.0.1` by default and rejects unapproved HTTP Host headers. Binding to a LAN address or using a tunnel expands the trust boundary and requires an explicit Host allowlist plus an access-controlled reverse proxy such as Cloudflare Access.
