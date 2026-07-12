import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  collectSessions,
  getRawSession,
  getSession,
  getSessionTimelinePage
} from "./core/session-registry.mjs";
import { authorizeControlHeader } from "./control/control-auth.mjs";
import { isAllowedRequestHost, securityHeaders } from "./http-security.mjs";

const FOLLOW_UP_BODY_LIMIT = 20 * 1024;
const FOLLOW_UP_PROMPT_LIMIT = 16 * 1024;
const CODEX_SESSION_PREFIX = "codex:session-file:";
const SESSION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createRequestHandler({
  providers,
  publicDir,
  allowedHosts,
  controlConfig = { enabled: false },
  followUpController = null
}) {
  return async function handleRequest(request, response) {
    try {
      if (!isAllowedRequestHost(request.headers.host, allowedHosts)) {
        sendJson(response, 403, { error: "Forbidden host" });
        return;
      }

      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

      if (url.pathname === "/api/control") {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "Method not allowed" });
          return;
        }
        handleControlDiscovery(request, response, controlConfig);
        return;
      }

      if (url.pathname.startsWith("/api/control/runs/")) {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "Method not allowed" });
          return;
        }
        handleRunStatus(request, response, url, controlConfig, followUpController);
        return;
      }

      if (isFollowUpPath(url.pathname)) {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Method not allowed" });
          return;
        }
        await handleFollowUp(
          request,
          response,
          url,
          providers,
          controlConfig,
          followUpController
        );
        return;
      }

      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed" });
        return;
      }

      if (url.pathname === "/api/providers") {
        sendJson(response, 200, {
          providers: providers.map((provider) => ({
            id: provider.id,
            displayName: provider.displayName
          }))
        });
        return;
      }

      if (url.pathname === "/api/sessions") {
        sendJson(response, 200, { sessions: await collectSessions(providers) });
        return;
      }

      if (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/timeline")) {
        const id = decodeURIComponent(
          url.pathname.slice("/api/sessions/".length, -"/timeline".length)
        );
        const timeline = await getSessionTimelinePage(providers, id, {
          limit: url.searchParams.get("limit"),
          cursor: url.searchParams.get("cursor")
        });
        sendJson(
          response,
          timeline ? 200 : 404,
          timeline ? { timeline } : { error: "Timeline not found" }
        );
        return;
      }

      if (url.pathname.startsWith("/api/sessions/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/sessions/".length));
        const session = await getSession(providers, id);
        sendJson(
          response,
          session ? 200 : 404,
          session ? { session } : { error: "Session not found" }
        );
        return;
      }

      if (url.pathname.startsWith("/api/raw/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/raw/".length));
        const raw = await getRawSession(providers, id);
        sendJson(response, raw ? 200 : 404, raw ? { raw } : { error: "Raw session not found" });
        return;
      }

      await sendStatic(response, url.pathname, publicDir);
    } catch (error) {
      sendJson(response, error?.statusCode ?? 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };
}

function handleControlDiscovery(request, response, controlConfig) {
  if (!controlConfig.enabled) {
    sendJson(response, 200, {
      followUp: { enabled: false, authorized: false, providers: [] }
    });
    return;
  }

  const authorization = request.headers.authorization;
  if (authorization !== undefined && !authorizeControlHeader(authorization, controlConfig)) {
    sendJson(response, 401, { error: "Invalid control token" });
    return;
  }

  sendJson(response, 200, {
    followUp: {
      enabled: true,
      authorized: authorizeControlHeader(authorization, controlConfig),
      providers: ["codex"]
    }
  });
}

function handleRunStatus(request, response, url, controlConfig, followUpController) {
  if (!controlConfig.enabled) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (!authorizeControlHeader(request.headers.authorization, controlConfig)) {
    sendJson(response, 401, { error: "Invalid control token" });
    return;
  }

  const runId = decodeURIComponent(url.pathname.slice("/api/control/runs/".length));
  const run = followUpController?.getRun(runId) ?? null;
  sendJson(response, run ? 200 : 404, run ? { run } : { error: "Run not found" });
}

async function handleFollowUp(
  request,
  response,
  url,
  providers,
  controlConfig,
  followUpController
) {
  if (!controlConfig.enabled) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (!authorizeControlHeader(request.headers.authorization, controlConfig)) {
    sendJson(response, 401, { error: "Invalid control token" });
    return;
  }

  const prompt = await readFollowUpPrompt(request);
  const id = decodeURIComponent(
    url.pathname.slice("/api/sessions/".length, -"/follow-up".length)
  );
  const session = await getSession(providers, id);
  if (!session) {
    sendJson(response, 404, { error: "Session not found" });
    return;
  }

  const sessionUuid = eligibleSessionUuid(session);
  if (!sessionUuid) {
    sendJson(response, 422, { error: "Session does not support Codex follow-up" });
    return;
  }

  if (session.turnState !== "idle" || followUpController?.isSessionActive(id)) {
    sendJson(response, 409, { error: "Session is not idle" });
    return;
  }

  if (!followUpController) {
    sendJson(response, 503, { error: "Codex follow-up is unavailable" });
    return;
  }

  if (!(await isDirectory(session.projectPath))) {
    sendJson(response, 503, { error: "Session project directory is unavailable" });
    return;
  }

  try {
    const run = await followUpController.submitFollowUp({
      sessionId: id,
      sessionUuid,
      projectPath: session.projectPath,
      prompt
    });
    sendJson(response, 202, {
      runId: run.id,
      sessionId: run.sessionId,
      status: run.status
    });
  } catch (error) {
    if (error?.code === "busy") {
      sendJson(response, 409, { error: "Session is not idle" });
      return;
    }
    if (error?.code === "spawn-unavailable" || error?.code === "capacity") {
      sendJson(response, 503, { error: "Codex follow-up is unavailable" });
      return;
    }
    throw error;
  }
}

async function readFollowUpPrompt(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) {
    throw new HttpError(400, "Content-Type must be application/json");
  }

  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > FOLLOW_UP_BODY_LIMIT) {
    throw new HttpError(413, "Request body is too large");
  }

  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > FOLLOW_UP_BODY_LIMIT) {
      throw new HttpError(413, "Request body is too large");
    }
    chunks.push(buffer);
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new HttpError(400, "Request body must be valid UTF-8");
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }

  if (!payload || typeof payload !== "object" || typeof payload.prompt !== "string") {
    throw new HttpError(400, "Prompt must be a string");
  }
  if (!payload.prompt.trim()) {
    throw new HttpError(400, "Prompt must not be empty");
  }
  if (Buffer.byteLength(payload.prompt, "utf8") > FOLLOW_UP_PROMPT_LIMIT) {
    throw new HttpError(413, "Prompt is too large");
  }
  return payload.prompt;
}

function eligibleSessionUuid(session) {
  if (session.providerId !== "codex" || !session.id.startsWith(CODEX_SESSION_PREFIX)) {
    return null;
  }
  const sessionUuid = session.id.slice(CODEX_SESSION_PREFIX.length);
  return SESSION_UUID_PATTERN.test(sessionUuid) && session.resumeRef?.value === sessionUuid
    ? sessionUuid
    : null;
}

function isFollowUpPath(pathname) {
  return pathname.startsWith("/api/sessions/") && pathname.endsWith("/follow-up");
}

async function isDirectory(directory) {
  if (typeof directory !== "string" || directory.length === 0) {
    return false;
  }
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function sendStatic(response, pathname, publicDir) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const absolutePath = path.resolve(publicDir, `.${safePath}`);

  if (!absolutePath.startsWith(`${publicDir}${path.sep}`)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
  } catch {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  response.writeHead(200, responseHeaders(contentType(absolutePath)));
  createReadStream(absolutePath).pipe(response);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, responseHeaders("application/json; charset=utf-8"));
  response.end(JSON.stringify(payload, null, 2));
}

function responseHeaders(contentTypeValue) {
  return {
    "Content-Type": contentTypeValue,
    "Cache-Control": "no-store",
    ...securityHeaders()
  };
}

function contentType(filePath) {
  switch (path.extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}
