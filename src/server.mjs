import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRequestHandler } from "./http-app.mjs";
import { parseAllowedHosts } from "./http-security.mjs";
import { createClaudeCodeProvider } from "./providers/claude-code.mjs";
import { createCodexProvider } from "./providers/codex.mjs";
import { createMockProvider } from "./providers/mock.mjs";
import { startListening } from "./server-listen.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const port = Number(process.env.PORT ?? 6280);
const host = process.env.HOST ?? "127.0.0.1";
let allowedHosts;

try {
  allowedHosts = parseAllowedHosts(process.env.GLASSLINE_ALLOWED_HOSTS);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const providers = [
  ...(process.env.GLASSLINE_MOCK === "0" ? [] : [createMockProvider()]),
  createCodexProvider(),
  createClaudeCodeProvider()
];

const server = createServer(createRequestHandler({ providers, publicDir, allowedHosts }));

startListening(server, { host, port });
