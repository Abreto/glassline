import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  collectSessions,
  getRawSession,
  getSession,
  getSessionTimelinePage
} from "./core/session-registry.mjs";
import { isAllowedRequestHost, securityHeaders } from "./http-security.mjs";

export function createRequestHandler({ providers, publicDir, allowedHosts }) {
  return async function handleRequest(request, response) {
    try {
      if (!isAllowedRequestHost(request.headers.host, allowedHosts)) {
        sendJson(response, 403, { error: "Forbidden host" });
        return;
      }

      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

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
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };
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
