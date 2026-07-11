export function startListening(
  server,
  {
    host,
    port,
    log = console.log,
    warn = console.warn,
    error = console.error,
    exit = process.exit
  }
) {
  server.on("error", (listenError) => {
    error(formatListenError(listenError, host, port));
    exit(1);
  });

  server.listen(port, host, () => {
    log(`Glassline is running at http://${host}:${port}`);
    if (!isLoopbackHost(host)) {
      warn(
        `Warning: Glassline is listening on non-loopback host ${host}. Session data may contain secrets; configure GLASSLINE_ALLOWED_HOSTS and protect access with external authentication.`
      );
    }
  });
}

function isLoopbackHost(host) {
  const normalized = String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.$/, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function formatListenError(error, host, port) {
  const url = `http://${host}:${port}`;

  if (error?.code === "EADDRINUSE") {
    return `Unable to start Glassline at ${url}: address already in use.`;
  }

  if (error?.code === "EPERM") {
    return `Unable to start Glassline at ${url}: permission denied.`;
  }

  const message = error instanceof Error ? error.message : String(error);
  return `Unable to start Glassline at ${url}: ${message}`;
}
