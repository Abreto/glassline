import assert from "node:assert/strict";
import test from "node:test";

test("app refresh preserves open disclosures for the selected session", async () => {
  const dom = installFakeDom();
  let detailRequests = 0;

  globalThis.fetch = async (url) => {
    if (url === "/api/sessions") {
      return jsonResponse({
        sessions: [sessionSummary()]
      });
    }

    if (String(url).startsWith("/api/sessions/")) {
      detailRequests += 1;
      return jsonResponse({
        session: {
          ...sessionSummary(),
          timeline: detailRequests === 1 ? [command("c1")] : [command("c1"), tool("t1")]
        }
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await importApp("refresh-disclosure-state");
  assert.equal(dom.timeline.details.length, 2);

  const activityGroup = dom.timeline.details.find((node) => node.dataset.disclosureId === "activity:c1");
  assert.ok(activityGroup);
  activityGroup.open = true;

  await dom.refresh.listeners.click();

  const refreshedGroup = dom.timeline.details.find((node) => node.dataset.disclosureId === "activity:c1");
  const newToolOutput = dom.timeline.details.find((node) => node.dataset.disclosureId === "t1:output");
  assert.ok(refreshedGroup);
  assert.equal(refreshedGroup.open, true);
  assert.equal(newToolOutput.open, false);
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

function command(id) {
  return {
    id,
    type: "command",
    createdAt: "2026-07-05T09:00:01.000Z",
    command: "npm test",
    output: "ok"
  };
}

function tool(id) {
  return {
    id,
    type: "tool_call",
    createdAt: "2026-07-05T09:00:02.000Z",
    name: "apply_patch",
    status: "complete",
    input: "*** Begin Patch",
    output: "Success"
  };
}

class FakeElement {
  constructor({ dataset = {} } = {}) {
    this.classList = new FakeClassList();
    this.dataset = dataset;
    this.listeners = {};
    this.textContent = "";
    this.details = [];
    this._innerHTML = "";
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? "");
    this.details = [...this._innerHTML.matchAll(/<details\b[^>]*data-disclosure-id="([^"]+)"/g)].map((match) => {
      return {
        dataset: {
          disclosureId: match[1]
        },
        open: false
      };
    });
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  querySelectorAll(selector) {
    if (selector === "details[data-disclosure-id]") {
      return this.details;
    }

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
