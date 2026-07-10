import assert from "node:assert/strict";
import test from "node:test";

test("app refresh preserves open disclosures for the selected session", async () => {
  const dom = installFakeDom();
  let timelineRequests = 0;

  globalThis.fetch = async (url) => {
    if (url === "/api/sessions") {
      return jsonResponse({
        sessions: [sessionSummary()]
      });
    }

    if (String(url).startsWith("/api/sessions/codex%3Aone/timeline")) {
      timelineRequests += 1;
      return jsonResponse({
        timeline: {
          items: timelineRequests === 1 ? [command("c1")] : [command("c1"), tool("t1")],
          hasMore: false
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

test("app loads older timeline pages when the timeline scrolls to the top", async () => {
  const dom = installFakeDom();
  const timelineUrls = [];

  globalThis.fetch = async (url) => {
    if (url === "/api/sessions") {
      return jsonResponse({
        sessions: [sessionSummary()]
      });
    }

    if (String(url).startsWith("/api/sessions/codex%3Aone/timeline")) {
      timelineUrls.push(String(url));
      const requestUrl = new URL(String(url), "http://glassline.local");
      if (requestUrl.searchParams.get("cursor") === "2") {
        return jsonResponse({
          timeline: {
            items: [message("m1", "oldest"), message("m2", "older")],
            hasMore: false
          }
        });
      }

      return jsonResponse({
        timeline: {
          items: [message("m3", "newer"), message("m4", "latest")],
          nextCursor: "2",
          hasMore: true
        }
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await importApp("scroll-loads-older");

  assert.equal(timelineUrls.length, 1);
  assert.match(timelineUrls[0], /limit=80/);
  assert.doesNotMatch(dom.timeline.innerHTML, /oldest/);
  assert.match(dom.timeline.innerHTML, /latest/);

  dom.timeline.scrollTop = 0;
  await dom.timeline.listeners.scroll();

  assert.equal(timelineUrls.length, 2);
  assert.match(timelineUrls[1], /cursor=2/);
  assert.ok(dom.timeline.innerHTML.indexOf("oldest") < dom.timeline.innerHTML.indexOf("latest"));
  assert.equal(dom.timeline.scrollTop, 200);
});

test("app keeps the current timeline visible when an older page fails", async () => {
  const dom = installFakeDom();
  const timelineUrls = [];

  globalThis.fetch = async (url) => {
    if (url === "/api/sessions") {
      return jsonResponse({
        sessions: [sessionSummary()]
      });
    }

    if (String(url).startsWith("/api/sessions/codex%3Aone/timeline")) {
      timelineUrls.push(String(url));
      const requestUrl = new URL(String(url), "http://glassline.local");
      if (requestUrl.searchParams.get("cursor") === "2") {
        throw new Error("older page down");
      }

      return jsonResponse({
        timeline: {
          items: [message("m3", "newer"), message("m4", "latest")],
          nextCursor: "2",
          hasMore: true
        }
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await importApp("older-page-error-keeps-current");

  dom.timeline.scrollTop = 0;
  await dom.timeline.listeners.scroll();

  assert.equal(timelineUrls.length, 2);
  assert.match(dom.timeline.innerHTML, /latest/);
  assert.doesNotMatch(dom.timeline.innerHTML, /Unable to load timeline/);
});

test("app shows new content while reading history without replacing the current timeline", async () => {
  const dom = installFakeDom();
  let sessionRequests = 0;
  const timelineUrls = [];

  globalThis.fetch = async (url) => {
    if (url === "/api/sessions") {
      sessionRequests += 1;
      return jsonResponse({
        sessions: [
          sessionSummary({
            lastUpdatedAt:
              sessionRequests === 1 ? "2026-07-05T09:00:00.000Z" : "2026-07-05T09:10:00.000Z"
          })
        ]
      });
    }

    if (String(url).startsWith("/api/sessions/codex%3Aone/timeline")) {
      timelineUrls.push(String(url));
      return jsonResponse({
        timeline: {
          items: [
            message("m1", "first"),
            message("m2", "second"),
            message("m3", "third"),
            message("m4", "fourth")
          ],
          hasMore: false
        }
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await importApp("new-content-state");
  dom.timeline.scrollTop = 0;

  await dom.refresh.listeners.click();

  assert.equal(timelineUrls.length, 1);
  assert.match(dom.timeline.innerHTML, /first/);
  assert.match(dom.timeline.innerHTML, /New content/);
});

test("app appends new content when the new content control is clicked", async () => {
  const dom = installFakeDom();
  let sessionRequests = 0;
  const timelineUrls = [];

  globalThis.fetch = async (url) => {
    if (url === "/api/sessions") {
      sessionRequests += 1;
      return jsonResponse({
        sessions: [
          sessionSummary({
            lastUpdatedAt:
              sessionRequests === 1 ? "2026-07-05T09:00:00.000Z" : "2026-07-05T09:10:00.000Z"
          })
        ]
      });
    }

    if (String(url).startsWith("/api/sessions/codex%3Aone/timeline")) {
      timelineUrls.push(String(url));
      return jsonResponse({
        timeline: {
          items:
            timelineUrls.length === 1
              ? [
                  message("m1", "first"),
                  message("m2", "second"),
                  message("m3", "third"),
                  message("m4", "fourth")
                ]
              : [message("m4", "fourth"), message("m5", "latest")],
          hasMore: false
        }
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await importApp("new-content-click-loads");
  dom.timeline.scrollTop = 0;

  await dom.refresh.listeners.click();
  await dom.body.listeners.click({
    target: {
      closest(selector) {
        return selector === "[data-load-newer]" ? { dataset: { loadNewer: "true" } } : null;
      }
    }
  });

  assert.equal(timelineUrls.length, 2);
  assert.match(dom.timeline.innerHTML, /latest/);
  assert.ok(dom.timeline.innerHTML.indexOf("fourth") < dom.timeline.innerHTML.indexOf("latest"));
  assert.doesNotMatch(dom.timeline.innerHTML, /New content/);
});

test("app replaces overlapping timeline items when loading new content", async () => {
  const dom = installFakeDom();
  let sessionRequests = 0;
  let timelineRequests = 0;

  globalThis.fetch = async (url) => {
    if (url === "/api/sessions") {
      sessionRequests += 1;
      return jsonResponse({
        sessions: [
          sessionSummary({
            lastUpdatedAt:
              sessionRequests === 1 ? "2026-07-05T09:00:00.000Z" : "2026-07-05T09:10:00.000Z"
          })
        ]
      });
    }

    if (String(url).startsWith("/api/sessions/codex%3Aone/timeline")) {
      timelineRequests += 1;
      return jsonResponse({
        timeline: {
          items:
            timelineRequests === 1
              ? [
                  message("m1", "first"),
                  message("m2", "second"),
                  message("m3", "third"),
                  command("c1", "still running")
                ]
              : [command("c1", "finished successfully"), message("m4", "latest")],
          hasMore: false
        }
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await importApp("new-content-replaces-overlap");
  dom.timeline.scrollTop = 0;

  await dom.refresh.listeners.click();
  await clickLoadNewer(dom);

  assert.match(dom.timeline.innerHTML, /finished successfully/);
  assert.doesNotMatch(dom.timeline.innerHTML, /still running/);
  assert.match(dom.timeline.innerHTML, /latest/);
});

test("app fetches intervening pages before clearing the new content state", async () => {
  const dom = installFakeDom();
  let sessionRequests = 0;
  const timelineUrls = [];

  globalThis.fetch = async (url) => {
    if (url === "/api/sessions") {
      sessionRequests += 1;
      return jsonResponse({
        sessions: [
          sessionSummary({
            lastUpdatedAt:
              sessionRequests === 1 ? "2026-07-05T09:00:00.000Z" : "2026-07-05T09:10:00.000Z"
          })
        ]
      });
    }

    if (String(url).startsWith("/api/sessions/codex%3Aone/timeline")) {
      timelineUrls.push(String(url));
      const requestUrl = new URL(String(url), "http://glassline.local");
      const cursor = requestUrl.searchParams.get("cursor");

      if (timelineUrls.length === 1) {
        return jsonResponse({
          timeline: {
            items: [
              message("m1", "first"),
              message("m2", "second"),
              message("m3", "third"),
              message("m4", "fourth")
            ],
            hasMore: false
          }
        });
      }

      if (cursor === "6") {
        return jsonResponse({
          timeline: {
            items: [
              message("m4", "fourth"),
              message("m5", "intervening one"),
              message("m6", "intervening two")
            ],
            nextCursor: "3",
            hasMore: true
          }
        });
      }

      return jsonResponse({
        timeline: {
          items: [message("m7", "newer"), message("m8", "latest")],
          nextCursor: "6",
          hasMore: true
        }
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await importApp("new-content-follows-pages-to-overlap");
  dom.timeline.scrollTop = 0;

  await dom.refresh.listeners.click();
  await clickLoadNewer(dom);

  assert.equal(timelineUrls.length, 3);
  assert.match(timelineUrls[2], /cursor=6/);
  assert.match(dom.timeline.innerHTML, /intervening one/);
  assert.match(dom.timeline.innerHTML, /intervening two/);
  assert.ok(dom.timeline.innerHTML.indexOf("intervening two") < dom.timeline.innerHTML.indexOf("latest"));
  assert.doesNotMatch(dom.timeline.innerHTML, /New content/);
});

test("app preserves timeline scroll position during a background reload", async () => {
  const dom = installFakeDom();
  let timelineRequests = 0;

  globalThis.fetch = async (url) => {
    if (url === "/api/sessions") {
      return jsonResponse({ sessions: [sessionSummary()] });
    }

    if (String(url).startsWith("/api/sessions/codex%3Aone/timeline")) {
      timelineRequests += 1;
      return jsonResponse({
        timeline: {
          items: [
            message("m1", "first"),
            message("m2", "second"),
            message("m3", "third"),
            message("m4", "fourth"),
            message("m5", "latest")
          ],
          hasMore: false
        }
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await importApp("background-reload-preserves-scroll");
  dom.timeline.scrollTop = 320;

  await dom.refresh.listeners.click();

  assert.equal(timelineRequests, 2);
  assert.equal(dom.timeline.scrollTop, 320);
});

test("app releases stale raw copy payloads during preserved refreshes", async () => {
  const dom = installFakeDom();
  let rawRequests = 0;

  globalThis.fetch = async (url) => {
    if (url === "/api/sessions") {
      return jsonResponse({ sessions: [sessionSummary()] });
    }

    if (String(url).startsWith("/api/sessions/codex%3Aone/timeline")) {
      return jsonResponse({
        timeline: { items: [message("m1", "first")], hasMore: false }
      });
    }

    if (String(url).startsWith("/api/raw/")) {
      rawRequests += 1;
      return jsonResponse({
        raw: {
          text: rawRequests === 1 ? "raw payload one" : "raw payload two",
          source: "session-file",
          confidence: "medium"
        }
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await importApp("raw-refresh-prunes-copy-payload");
  await dom.tabs.raw.listeners.click();
  const staleCopyId = copyIdFrom(dom.raw.innerHTML);

  await dom.refresh.listeners.click();
  const currentCopyId = copyIdFrom(dom.raw.innerHTML);

  assert.equal(rawRequests, 2);
  assert.notEqual(currentCopyId, staleCopyId);

  await clickCopy(dom, staleCopyId);
  assert.deepEqual(dom.clipboardWrites, []);

  await clickCopy(dom, currentCopyId);
  assert.deepEqual(dom.clipboardWrites, ["raw payload two"]);
});

test("app appends new content when scrolling down to the loaded window bottom", async () => {
  const dom = installFakeDom();
  let sessionRequests = 0;
  const timelineUrls = [];

  globalThis.fetch = async (url) => {
    if (url === "/api/sessions") {
      sessionRequests += 1;
      return jsonResponse({
        sessions: [
          sessionSummary({
            lastUpdatedAt:
              sessionRequests === 1 ? "2026-07-05T09:00:00.000Z" : "2026-07-05T09:10:00.000Z"
          })
        ]
      });
    }

    if (String(url).startsWith("/api/sessions/codex%3Aone/timeline")) {
      timelineUrls.push(String(url));
      return jsonResponse({
        timeline: {
          items:
            timelineUrls.length === 1
              ? [
                  message("m1", "first"),
                  message("m2", "second"),
                  message("m3", "third"),
                  message("m4", "fourth")
                ]
              : [message("m4", "fourth"), message("m5", "latest")],
          hasMore: false
        }
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await importApp("new-content-scroll-loads");
  dom.timeline.scrollTop = 0;

  await dom.refresh.listeners.click();
  dom.timeline.scrollTop = dom.timeline.scrollHeight - dom.timeline.clientHeight;
  await dom.timeline.listeners.scroll();

  assert.equal(timelineUrls.length, 2);
  assert.match(dom.timeline.innerHTML, /latest/);
});

async function importApp(name) {
  const url = new URL("../public/app.js", import.meta.url);
  url.search = `?${name}-${Date.now()}-${Math.random()}`;
  await import(url.href);
}

function installFakeDom() {
  const clipboardWrites = [];
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
        writeText: async (text) => clipboardWrites.push(text)
      }
    }
  });

  return { ...elements, tabs, clipboardWrites };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}

function sessionSummary(overrides = {}) {
  return {
    id: "codex:one",
    providerName: "Codex",
    title: "One",
    status: "unknown",
    quality: "partial",
    lastUpdatedAt: "2026-07-05T09:00:00.000Z",
    sources: [],
    timeline: [],
    ...overrides
  };
}

function command(id, output = "ok") {
  return {
    id,
    type: "command",
    createdAt: "2026-07-05T09:00:01.000Z",
    command: "npm test",
    output
  };
}

async function clickLoadNewer(dom) {
  await dom.body.listeners.click({
    target: {
      closest(selector) {
        return selector === "[data-load-newer]" ? { dataset: { loadNewer: "true" } } : null;
      }
    }
  });
}

async function clickCopy(dom, copyId) {
  await dom.body.listeners.click({
    target: {
      closest(selector) {
        return selector === "[data-copy-id]" ? { dataset: { copyId } } : null;
      }
    }
  });
}

function copyIdFrom(html) {
  return String(html).match(/data-copy-id="([^"]+)"/)?.[1];
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

function message(id, content) {
  return {
    id,
    type: "message",
    role: "assistant",
    createdAt: "2026-07-05T09:00:00.000Z",
    content
  };
}

class FakeElement {
  constructor({ dataset = {} } = {}) {
    this.classList = new FakeClassList();
    this.dataset = dataset;
    this.listeners = {};
    this.textContent = "";
    this.details = [];
    this.timelineBlocks = [];
    this.clientHeight = 100;
    this.scrollHeight = 0;
    this.scrollTop = 0;
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
    this.timelineBlocks = [...this._innerHTML.matchAll(/data-timeline-type="([^"]+)"/g)].map((match, index) => {
      return {
        id: `timeline-block-${index}`,
        dataset: {
          timelineType: match[1]
        },
        scrollIntoView() {}
      };
    });
    this.scrollHeight = this.timelineBlocks.length * 100;
    this.scrollTop = Math.min(this.scrollTop, Math.max(0, this.scrollHeight - this.clientHeight));
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  querySelectorAll(selector) {
    if (selector === "details[data-disclosure-id]") {
      return this.details;
    }

    if (selector === "[data-timeline-type]") {
      return this.timelineBlocks;
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
