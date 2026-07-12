export async function requestJson(
  url,
  { fetchImpl = globalThis.fetch, label = "Request failed", request } = {}
) {
  let response;

  try {
    response = await fetchImpl(url, request);
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const payload = await readJson(response, label);
  if (!response.ok) {
    throw new Error(`${label}: ${payload?.error ?? `HTTP ${response.status}`}`);
  }

  return payload;
}

export function renderErrorState(title, detail) {
  const detailHtml = detail ? `<span>: ${escapeHtml(detail)}</span>` : "";
  return `<p class="empty-state" role="alert"><strong>${escapeHtml(title)}</strong>${detailHtml}</p>`;
}

async function readJson(response, label) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${label}: invalid JSON response`);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
