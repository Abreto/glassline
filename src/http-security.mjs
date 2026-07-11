import { isIP } from "node:net";

const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "::1"];
const FORBIDDEN_HOST_CHARACTERS = /[\s/@\\?#]/;

export function parseAllowedHosts(value = "") {
  const allowedHosts = new Set(DEFAULT_ALLOWED_HOSTS);

  for (const rawEntry of String(value).split(",")) {
    const entry = rawEntry.trim();
    if (!entry) {
      continue;
    }

    const normalized = normalizeConfiguredHost(entry);
    if (!normalized) {
      throw new Error(`Invalid GLASSLINE_ALLOWED_HOSTS entry: ${entry}`);
    }
    allowedHosts.add(normalized);
  }

  return allowedHosts;
}

export function isAllowedRequestHost(hostHeader, allowedHosts) {
  if (typeof hostHeader !== "string" || !hostHeader || FORBIDDEN_HOST_CHARACTERS.test(hostHeader)) {
    return false;
  }

  try {
    const url = new URL(`http://${hostHeader}`);
    const hostname = normalizeHostname(url.hostname);
    return Boolean(hostname && allowedHosts.has(hostname));
  } catch {
    return false;
  }
}

export function isLoopbackHost(host) {
  return DEFAULT_ALLOWED_HOSTS.includes(normalizeHostname(String(host ?? "")));
}

export function securityHeaders() {
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'none'"
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-origin"
  };
}

function normalizeConfiguredHost(value) {
  if (FORBIDDEN_HOST_CHARACTERS.test(value) || value.includes("*") || value.includes("[")) {
    return null;
  }

  const normalized = normalizeHostname(value);
  if (!normalized) {
    return null;
  }
  if (isIP(normalized)) {
    return normalized;
  }
  if (normalized.includes(":")) {
    return null;
  }
  if (normalized.length > 253) {
    return null;
  }

  const labels = normalized.split(".");
  return labels.every(isValidHostnameLabel) ? normalized : null;
}

function normalizeHostname(value) {
  let hostname = value.trim().toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }
  if (hostname.endsWith(".")) {
    hostname = hostname.slice(0, -1);
  }
  return hostname;
}

function isValidHostnameLabel(label) {
  return (
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  );
}
