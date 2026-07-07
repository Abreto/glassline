export function startListening(
  server,
  {
    host,
    port,
    log = console.log,
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
  });
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
