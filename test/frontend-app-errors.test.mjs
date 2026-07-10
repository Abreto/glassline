import assert from "node:assert/strict";
import test from "node:test";

test("app renders a recoverable sessions load error", async () => {
  const dom = installFakeDom();
  globalThis.fetch = async () => {
    throw new Error("backend down");
  };

  await importApp("sessions-error");

  assert.match(dom.timeline.innerHTML, /Unable to load sessions/);
  assert.match(dom.timeline.innerHTML, /backend down/);
  assert.equal(typeof dom.refresh.listeners.click, "function");
});

test("app renders a readable timeline page load error", async () => {
  const dom = installFakeDom();
  globalThis.fetch = async (url) => {
    if (url === "/api/sessions") {
      return jsonResponse({
        sessions: [sessionSummary()]
      });
    }

    if (String(url).startsWith("/api/sessions/codex%3Aone/timeline")) {
      throw new Error("timeline down");
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await importApp("timeline-error");

  assert.match(dom.timeline.innerHTML, /Unable to load timeline/);
  assert.match(dom.timeline.innerHTML, /timeline down/);
});

test("app renders a readable raw data load error", async () => {
  const dom = installFakeDom();
  globalThis.fetch = async (url) => {
    if (url === "/api/sessions") {
      return jsonResponse({
        sessions: [sessionSummary()]
      });
    }

    if (String(url).startsWith("/api/sessions/codex%3Aone/timeline")) {
      return jsonResponse({
        timeline: { items: [], hasMore: false }
      });
    }

    if (String(url).startsWith("/api/raw/")) {
      throw new Error("raw down");
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await importApp("raw-error");
  await dom.tabs.raw.listeners.click();

  assert.match(dom.raw.innerHTML, /Unable to load raw data/);
  assert.match(dom.raw.innerHTML, /raw down/);
});

async function importApp(name) {
  const url = new URL("../public/app.js", import.meta.url);
  url.search = `?${name}-${Date.now()}-${Math.random()}`;
  await import(url.href);
}

function installFakeDom() {
  const elements = {
    list: new FakeElement(),
    count: new FakeElement(),
    detailHeader: new FakeElement(),
    timeline: new FakeElement(),
    raw: new FakeElement(),
    refresh: new FakeElement(),
    body: new FakeElement()
  };
  const tabs = {
    timeline: new FakeElement({ dataset: { view: "timeline" } }),
    raw: new FakeElement({ dataset: { view: "raw" } })
  };

  globalThis.document = {
    body: elements.body,
    querySelector(selector) {
      return {
        "#session-list": elements.list,
        "#session-count": elements.count,
        "#detail-header": elements.detailHeader,
        "#timeline-view": elements.timeline,
        "#raw-view": elements.raw,
        "#refresh-button": elements.refresh
      }[selector];
    },
    querySelectorAll(selector) {
      return selector === ".tab" ? [tabs.timeline, tabs.raw] : [];
    }
  };
  globalThis.window = {
    requestAnimationFrame(callback) {
      callback();
    },
    setInterval() {}
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async () => {}
      }
    }
  });

  return { ...elements, tabs };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}

function sessionSummary() {
  return {
    id: "codex:one",
    providerName: "Codex",
    title: "One",
    status: "unknown",
    quality: "partial",
    lastUpdatedAt: "2026-07-05T09:00:00.000Z",
    sources: [],
    timeline: []
  };
}

class FakeElement {
  constructor({ dataset = {} } = {}) {
    this.classList = new FakeClassList();
    this.dataset = dataset;
    this.innerHTML = "";
    this.listeners = {};
    this.textContent = "";
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  querySelectorAll() {
    return [];
  }
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, force) {
    if (force) {
      this.values.add(name);
    } else {
      this.values.delete(name);
    }
  }
}
