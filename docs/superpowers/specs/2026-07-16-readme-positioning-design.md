# README Positioning Design

## Goal

Make Glassline's non-invasive product position immediately clear in the README: it monitors existing local agent sessions without installing provider hooks, changing provider configuration, wrapping the provider CLI, or becoming another agent runtime.

The README should describe the intended personal workflow in the existing first-person voice:

- Use Glassline to monitor progress, read results comfortably on a phone, inspect session history, and optionally send a lightweight follow-up to an existing idle Codex session.
- Use mobile SSH with tmux and the provider's official CLI for full interactive control, including starting sessions, shell work, and complex approvals.

## Scope

Update only the opening description and `Why Glassline` section of `README.md`.

The opening description will state the non-invasive behavior before describing the optional follow-up capability. `Why Glassline` will connect that behavior to the author's mobile monitoring workflow and explicitly describe when mobile SSH, tmux, and an official provider CLI are the better tools.

Existing security guidance, control documentation, roadmap language, and continuing non-goals remain authoritative and will not be weakened or duplicated.

## Wording Constraints

- Keep the first-person voice in `Why Glassline`.
- Describe the product as non-invasive rather than zero-configuration. Glassline itself and authenticated remote access still require setup.
- Do not name or compare against competitors.
- Do not imply that private provider files are stable APIs or that session discovery is guaranteed.
- Do not broaden the existing Codex follow-up capability.
- Do not suggest that Glassline offers a shell, PTY, manual approval interface, new-session creation, or general remote control.
- Keep the opening concise enough that installation and security information remain easy to reach.

## Validation

Review the rendered Markdown structure and confirm that:

- The first screen communicates monitoring, mobile result reading, and non-invasive operation.
- The optional follow-up remains explicitly narrow and Codex-only.
- Full interactive work is directed to mobile SSH, tmux, and the official provider CLI.
- The revised wording does not contradict `SECURITY.md`, the control documentation, the roadmap, or `AGENTS.md`.

No runtime behavior changes, so automated test changes are not required. The final repository verification will still run the existing release check.
