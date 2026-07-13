# Launchd Control Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist validated `GLASSLINE_ALLOWED_HOSTS` together with the already supported control token when installing the macOS LaunchAgent.

**Architecture:** Extend the existing plist builder with one optional environment entry. The installer validates the allowlist through `parseAllowedHosts()` before writing the plist, then passes the original value to the builder so launchd starts Glassline with the same configuration.

**Tech Stack:** Node.js 20 built-ins, launchd plist XML, Node test runner.

---

### Task 1: Propagate the Host allowlist

**Files:**
- Modify: `test/launchd-utils.test.mjs`
- Modify: `scripts/launchd-utils.mjs`
- Modify: `scripts/install-launchd.mjs`

- [ ] **Step 1: Write a failing plist test**

Pass `allowedHosts: "glassline.example.com,192.0.2.10"` to `buildLaunchdPlist()` and assert the plist contains:

```xml
<key>GLASSLINE_ALLOWED_HOSTS</key>
<string>glassline.example.com,192.0.2.10</string>
```

Also keep the default contract assertion proving that the key is absent when no value is supplied.

- [ ] **Step 2: Verify the test fails**

Run: `node --test test/launchd-utils.test.mjs`

Expected: the new allowlist assertion fails because the builder does not emit the key.

- [ ] **Step 3: Implement minimal propagation**

Add `allowedHosts` to `buildLaunchdPlist()` and emit it through `launchdEnvironmentEntry`. In `install-launchd.mjs`, read `process.env.GLASSLINE_ALLOWED_HOSTS`, call `parseAllowedHosts(allowedHosts)` before plist creation, and pass `allowedHosts` into the builder.

- [ ] **Step 4: Verify focused tests**

Run: `node --test test/http-security.test.mjs test/launchd-utils.test.mjs`

Expected: all focused tests pass.

### Task 2: Document and verify

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Document the combined install command**

Add this example and explain that the installer persists both optional values while keeping `HOST=127.0.0.1`:

```sh
GLASSLINE_ALLOWED_HOSTS=glassline.example.com \
GLASSLINE_CONTROL_TOKEN='<generated-token>' \
npm run install-launchd
```

- [ ] **Step 2: Update agent handoff**

Record that the launchd installer validates and propagates the optional Host allowlist and stores a configured control token in a `0600` plist.

- [ ] **Step 3: Run release verification**

Run: `npm run release-check`

Run: `npm pack --dry-run --json --cache /private/tmp/glassline-npm-cache`

Run: `git diff --check`

Expected: all tests and the history scan pass, the package contains only expected files, and the diff has no whitespace errors.
