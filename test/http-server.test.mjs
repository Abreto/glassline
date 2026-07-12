import assert from "node:assert/strict";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createRequestHandler } from "../src/http-app.mjs";
import { parseControlConfig } from "../src/control/control-auth.mjs";
import { parseAllowedHosts } from "../src/http-security.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(repoRoot, "public");

test("request handler rejects untrusted hosts before providers are read", async () => {
  let listCalls = 0;
  const handler = createRequestHandler({
    providers: [
      {
        id: "counted",
        displayName: "Counted",
        async listSessions() {
          listCalls += 1;
          return [];
        }
      }
    ],
    publicDir,
    allowedHosts: parseAllowedHosts()
  });
  const response = fakeResponse();

  await handler(fakeRequest("/api/sessions", { host: "attacker.example" }), response);

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { error: "Forbidden host" });
  assert.equal(listCalls, 0);
  assertSecurityHeaders(response.headers);
});

test("request handler serves APIs for explicitly allowed hosts", async () => {
  const handler = createRequestHandler({
    providers: [{ id: "mock", displayName: "Mock", async listSessions() { return []; } }],
    publicDir,
    allowedHosts: parseAllowedHosts("viewer.example.com")
  });
  const response = fakeResponse();

  await handler(fakeRequest("/api/providers", { host: "viewer.example.com:443" }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    providers: [{ id: "mock", displayName: "Mock" }]
  });
  assertSecurityHeaders(response.headers);
});

test("request handler adds security headers to error responses", async () => {
  const handler = createRequestHandler({
    providers: [],
    publicDir,
    allowedHosts: parseAllowedHosts()
  });

  for (const [request, expectedStatus] of [
    [fakeRequest("/missing", { host: "localhost:6280" }), 404],
    [fakeRequest("/api/providers", { host: "localhost:6280", method: "POST" }), 405],
    [fakeRequest("/api/sessions/%", { host: "localhost:6280" }), 500]
  ]) {
    const response = fakeResponse();
    await handler(request, response);
    assert.equal(response.statusCode, expectedStatus);
    assertSecurityHeaders(response.headers);
  }
});

test("control discovery reports disabled, locked, and authorized states", async () => {
  const disabled = createHandler();
  const disabledResponse = fakeResponse();
  await disabled(fakeRequest("/api/control", { host: "localhost" }), disabledResponse);
  assert.deepEqual(JSON.parse(disabledResponse.body), {
    followUp: { enabled: false, authorized: false, providers: [] }
  });

  const enabled = createHandler({ control: true });
  const lockedResponse = fakeResponse();
  await enabled(fakeRequest("/api/control", { host: "localhost" }), lockedResponse);
  assert.deepEqual(JSON.parse(lockedResponse.body), {
    followUp: { enabled: true, authorized: false, providers: ["codex"] }
  });

  const authorizedResponse = fakeResponse();
  await enabled(
    fakeRequest("/api/control", {
      host: "localhost",
      authorization: `Bearer ${CONTROL_TOKEN}`
    }),
    authorizedResponse
  );
  assert.equal(JSON.parse(authorizedResponse.body).followUp.authorized, true);

  const invalidResponse = fakeResponse();
  await enabled(
    fakeRequest("/api/control", { host: "localhost", authorization: "Bearer invalid" }),
    invalidResponse
  );
  assert.equal(invalidResponse.statusCode, 401);
  assertSecurityHeaders(invalidResponse.headers);
});

test("follow-up rejects disabled and unauthorized requests before providers are read", async () => {
  let sessionReads = 0;
  let submissions = 0;
  const providers = [providerWithSession({ onRead: () => { sessionReads += 1; } })];
  const controller = fakeController({ onSubmit: () => { submissions += 1; } });

  for (const [handler, expectedStatus] of [
    [createHandler({ providers, controller }), 404],
    [createHandler({ providers, controller, control: true }), 401]
  ]) {
    const response = fakeResponse();
    await handler(
      fakeRequest(`/api/sessions/${encodeURIComponent(SESSION_ID)}/follow-up`, {
        host: "localhost",
        method: "POST",
        body: JSON.stringify({ prompt: "Continue" }),
        contentType: "application/json"
      }),
      response
    );
    assert.equal(response.statusCode, expectedStatus);
  }

  assert.equal(sessionReads, 0);
  assert.equal(submissions, 0);
});

test("follow-up accepts one authenticated idle Codex session prompt", async () => {
  const calls = [];
  const handler = createHandler({
    control: true,
    providers: [providerWithSession()],
    controller: fakeController({ onSubmit: (submission) => calls.push(submission) })
  });
  const response = fakeResponse();

  await handler(
    fakeRequest(`/api/sessions/${encodeURIComponent(SESSION_ID)}/follow-up`, {
      host: "localhost",
      method: "POST",
      authorization: `Bearer ${CONTROL_TOKEN}`,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ prompt: "Continue with the tests.", ignored: true })
    }),
    response
  );

  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), {
    runId: "run-one",
    sessionId: SESSION_ID,
    status: "running"
  });
  assert.deepEqual(calls, [{
    sessionId: SESSION_ID,
    sessionUuid: SESSION_UUID,
    projectPath: repoRoot,
    prompt: "Continue with the tests."
  }]);
});

test("follow-up validates JSON size and session eligibility", async () => {
  const baseOptions = {
    control: true,
    controller: fakeController()
  };
  const cases = [
    {
      handler: createHandler(baseOptions),
      request: controlRequest({ contentType: "text/plain", body: "hello" }),
      status: 400
    },
    {
      handler: createHandler(baseOptions),
      request: controlRequest({ body: "{" }),
      status: 400
    },
    {
      handler: createHandler(baseOptions),
      request: controlRequest({ body: JSON.stringify({ prompt: " ".repeat(3) }) }),
      status: 400
    },
    {
      handler: createHandler(baseOptions),
      request: controlRequest({ body: JSON.stringify({ prompt: "x".repeat(17 * 1024) }) }),
      status: 413
    },
    {
      handler: createHandler({ ...baseOptions, providers: [providerWithSession({ turnState: "running" })] }),
      request: controlRequest(),
      status: 409
    },
    {
      handler: createHandler({ ...baseOptions, providers: [providerWithSession({ id: "codex:process:1" })] }),
      request: controlRequest({ id: "codex:process:1" }),
      status: 422
    }
  ];

  for (const testCase of cases) {
    const response = fakeResponse();
    await testCase.handler(testCase.request, response);
    assert.equal(response.statusCode, testCase.status);
    assertSecurityHeaders(response.headers);
  }
});

test("run status requires authorization and returns bounded controller state", async () => {
  const handler = createHandler({ control: true, controller: fakeController() });
  const unauthorized = fakeResponse();
  await handler(fakeRequest("/api/control/runs/run-one", { host: "localhost" }), unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const response = fakeResponse();
  await handler(
    fakeRequest("/api/control/runs/run-one", {
      host: "localhost",
      authorization: `Bearer ${CONTROL_TOKEN}`
    }),
    response
  );
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    run: { id: "run-one", sessionId: SESSION_ID, status: "running", startedAt: "2026-07-13T00:00:00.000Z" }
  });
});

const CONTROL_TOKEN = "abcdefghijklmnopqrstuvwxyz123456";
const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = `codex:session-file:${SESSION_UUID}`;

function createHandler({ providers = [], controller, control = false } = {}) {
  return createRequestHandler({
    providers,
    publicDir,
    allowedHosts: parseAllowedHosts(),
    controlConfig: parseControlConfig(
      control ? { GLASSLINE_CONTROL_TOKEN: CONTROL_TOKEN } : {}
    ),
    followUpController: controller
  });
}

function providerWithSession({ id = SESSION_ID, turnState = "idle", onRead = () => {} } = {}) {
  return {
    id: "codex",
    displayName: "Codex",
    async listSessions() { return []; },
    async getSession(requestedId) {
      onRead();
      return requestedId === id
        ? {
            id,
            providerId: "codex",
            providerName: "Codex",
            title: "Fixture",
            projectPath: repoRoot,
            status: "unknown",
            turnState,
            quality: "partial",
            lastUpdatedAt: "2026-07-13T00:00:00.000Z",
            sources: [],
            resumeRef: { value: SESSION_UUID, confidence: "medium", sourceRefs: [] },
            timeline: []
          }
        : null;
    }
  };
}

function fakeController({ onSubmit = () => {} } = {}) {
  return {
    isSessionActive() { return false; },
    async submitFollowUp(submission) {
      onSubmit(submission);
      return { id: "run-one", sessionId: SESSION_ID, status: "running", startedAt: "2026-07-13T00:00:00.000Z" };
    },
    getRun(runId) {
      return runId === "run-one"
        ? { id: runId, sessionId: SESSION_ID, status: "running", startedAt: "2026-07-13T00:00:00.000Z" }
        : null;
    }
  };
}

function controlRequest({ id = SESSION_ID, body = JSON.stringify({ prompt: "Continue" }), contentType = "application/json" } = {}) {
  return fakeRequest(`/api/sessions/${encodeURIComponent(id)}/follow-up`, {
    host: "localhost",
    method: "POST",
    authorization: `Bearer ${CONTROL_TOKEN}`,
    contentType,
    body
  });
}

function fakeRequest(url, { host, method = "GET", authorization, contentType, body = "" } = {}) {
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  request.method = method;
  request.url = url;
  request.headers = {
    ...(host === undefined ? {} : { host }),
    ...(authorization ? { authorization } : {}),
    ...(contentType ? { "content-type": contentType } : {})
  };
  return request;
}

function fakeResponse() {
  return {
    statusCode: undefined,
    headers: {},
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body += body;
    }
  };
}

function assertSecurityHeaders(headers) {
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["Cross-Origin-Resource-Policy"], "same-origin");
  assert.match(headers["Content-Security-Policy"], /default-src 'self'/);
}
