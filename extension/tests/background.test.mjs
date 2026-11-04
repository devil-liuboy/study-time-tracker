import test from "node:test";
import assert from "node:assert/strict";

let moduleCounter = 0;
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const event = () => ({ listeners: [], addListener(listener) { this.listeners.push(listener); }, emit(...args) { for (const listener of this.listeners) listener(...args); } });

async function workerHarness({ paired = false, fetchImpl = null } = {}) {
  const saved = new Map(["chrome", "navigator", "fetch", "setInterval", "clearInterval"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const state = {
    local: paired ? { studytime_pair_token: "ab".repeat(32) } : {}, session: {}, requests: [], intervals: new Map(),
    window: { id: 1, focused: true, type: "normal", state: "normal", left: 0, top: 0, width: 1200, height: 800 },
    tab: { id: 2, windowId: 1, active: true, incognito: false, url: "https://github.com/private?secret" },
  };
  const storageArea = name => ({
    async get(key) { return { [key]: state[name][key] }; },
    async set(values) { Object.assign(state[name], values); },
    async remove(key) { delete state[name][key]; },
  });
  const api = {
    storage: { local: storageArea("local"), session: storageArea("session") },
    runtime: { id: "test-extension", getURL: path => `chrome-extension://test-extension/${path}`, onInstalled: event(), onStartup: event(), onMessage: event() },
    alarms: { created: [], async create(name, options) { this.created.push({ name, options }); }, onAlarm: event() },
    windows: { async getLastFocused() { return { ...state.window }; }, onFocusChanged: event(), onRemoved: event() },
    tabs: { async query() { return [{ ...state.tab }]; }, onActivated: event(), onRemoved: event(), onUpdated: event() },
  };
  let intervalId = 0;
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: api });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "Chrome/130.0" } });
  globalThis.setInterval = (callback, milliseconds) => { const id = ++intervalId; state.intervals.set(id, { callback, milliseconds }); return id; };
  globalThis.clearInterval = id => state.intervals.delete(id);
  globalThis.fetch = async (url, options) => {
    state.requests.push({ url, options, body: JSON.parse(options.body) });
    return fetchImpl ? fetchImpl(url, options, state.requests.length) : { ok: true, status: 200 };
  };
  await import(`../background.js?test=${++moduleCounter}`);
  return {
    state, api,
    popup(message) {
      return new Promise((resolve, reject) => {
        const handled = api.runtime.onMessage.listeners[0](message, { id: api.runtime.id, url: api.runtime.getURL("popup.html") }, resolve);
        if (!handled && message.type !== "STUDYTIME_SAVE_TOKEN") reject(new Error("message not handled"));
      });
    },
    restore() {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test("worker pairs locally, polls static PDFs, and stops high-frequency polling on focus loss", async () => {
  const harness = await workerHarness();
  try {
    const { state, api } = harness;
    api.runtime.onStartup.emit();
    await tick();
    assert.equal(state.requests.length, 0);
    assert.equal(state.intervals.size, 0);
    const paired = await harness.popup({ type: "STUDYTIME_SAVE_TOKEN", token: "ab".repeat(32) });
    assert.equal(paired.ok, true);
    assert.equal(paired.status.connected, true);
    assert.equal(state.intervals.size, 1);
    assert.equal([...state.intervals.values()][0].milliseconds, 2000);
    state.tab.url = "https://arxiv.org/pdf/2601.00001?download=secret";
    [...state.intervals.values()][0].callback();
    await tick();
    assert.equal(state.requests.at(-1).body.domain, "arxiv.org");
    assert.equal(JSON.stringify(state.requests.at(-1).body).includes("secret"), false);
    assert.equal(state.requests.at(-1).options.redirect, "error");
    assert.equal(state.requests.at(-1).options.credentials, "omit");
    assert.equal(state.requests.at(-1).url, "http://127.0.0.1:47831/v1/activity");
    state.window.focused = false;
    api.windows.onFocusChanged.emit(-1);
    await tick();
    assert.equal(state.requests.at(-1).body.focused, false);
    assert.equal(state.requests.at(-1).body.domain, null);
    assert.equal(state.intervals.size, 0);
  } finally {
    harness.restore();
  }
});

test("rapid navigation coalesces pending work and never posts a captured stale URL later", async () => {
  let releaseFirst;
  const firstResponse = new Promise(resolve => { releaseFirst = resolve; });
  const harness = await workerHarness({ paired: true, fetchImpl: async (_url, _options, number) => number === 1 ? firstResponse : { ok: true, status: 200 } });
  try {
    const { state, api } = harness;
    api.tabs.onActivated.emit({ tabId: 2, windowId: 1 });
    await tick();
    assert.equal(state.requests.length, 1);
    state.tab.url = "https://arxiv.org/abs/new";
    for (let i = 0; i < 20; i++) api.tabs.onUpdated.emit(2, { status: "loading" });
    await tick();
    assert.equal(state.requests.length, 1, "no concurrent fetch can overtake the first");
    releaseFirst({ ok: true, status: 200 });
    await tick();
    assert.deepEqual(state.requests.map(request => request.body.domain), ["github.com", "arxiv.org"]);
    assert.equal(state.session.studytime_connection_status.domain, "arxiv.org");
  } finally {
    releaseFirst({ ok: true, status: 200 });
    await tick();
    harness.restore();
  }
});

test("only the extension popup can change pairing, and disconnect clears desktop state first", async () => {
  const harness = await workerHarness({ paired: true });
  try {
    const { state, api } = harness;
    const handled = api.runtime.onMessage.listeners[0](
      { type: "STUDYTIME_DISCONNECT" },
      { id: api.runtime.id, url: "https://github.com", tab: { id: 2 } },
      () => { throw new Error("untrusted sender got a reply"); },
    );
    assert.equal(handled, false);
    assert.ok(state.local.studytime_pair_token);
    const result = await harness.popup({ type: "STUDYTIME_DISCONNECT" });
    assert.equal(result.ok, true);
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].body.domain, null);
    assert.equal(state.requests[0].body.focused, false);
    assert.equal(state.local.studytime_pair_token, undefined);
    assert.equal(state.session.studytime_connection_status.configured, false);
    assert.equal(state.intervals.size, 0);
  } finally {
    harness.restore();
  }
});

test("internal or incognito tabs clear activity and never start high-frequency polling", async () => {
  const harness = await workerHarness({ paired: true });
  try {
    const { state, api } = harness;
    state.tab.url = "chrome://settings";
    api.alarms.onAlarm.emit({ name: "studytime-refresh" });
    await tick();
    assert.equal(state.requests.at(-1).body.domain, null);
    assert.equal(state.intervals.size, 0);
    state.tab.url = "https://github.com/private";
    state.tab.incognito = true;
    api.tabs.onActivated.emit({ tabId: 2, windowId: 1 });
    await tick();
    assert.equal(state.requests.at(-1).body.domain, null);
    assert.equal(state.requests.at(-1).body.incognito, true);
    assert.equal(state.intervals.size, 0);
  } finally {
    harness.restore();
  }
});
