import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectSessions, getRawSession, getSession } from "./core/session-registry.mjs";
import { createClaudeCodeProvider } from "./providers/claude-code.mjs";
import { createCodexProvider } from "./providers/codex.mjs";
import { createMockProvider } from "./providers/mock.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const port = Number(process.env.PORT ?? 6280);
const host = process.env.HOST ?? "127.0.0.1";

const providers = [
  ...(process.env.GLASSLINE_MOCK === "0" ? [] : [createMockProvider()]),
  createCodexProvider(),
  createClaudeCodeProvider()
];

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

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

    if (url.pathname.startsWith("/api/sessions/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/sessions/".length));
      const session = await getSession(providers, id);
      sendJson(response, session ? 200 : 404, session ? { session } : { error: "Session not found" });
      return;
    }

    if (url.pathname.startsWith("/api/raw/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/raw/".length));
      const raw = await getRawSession(providers, id);
      sendJson(response, raw ? 200 : 404, raw ? { raw } : { error: "Raw session not found" });
      return;
    }

    await sendStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, host, () => {
  console.log(`Glassline is running at http://${host}:${port}`);
});

async function sendStatic(response, pathname) {
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

  response.writeHead(200, {
    "Content-Type": contentType(absolutePath),
    "Cache-Control": "no-store"
  });
  createReadStream(absolutePath).pipe(response);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
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
