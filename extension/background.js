import {
  ACTIVITY_ENDPOINT, TOKEN_KEY, STATUS_KEY, normalizeToken, browserKind,
  activitySnapshot, isPopupSender,
} from "./protocol.mjs";

const BROWSER = browserKind(navigator.userAgent);
const ALARM_NAME = "studytime-refresh";
let serial = Promise.resolve();
let pendingRefresh = null;
let pollingTimer = null;

// Serialize snapshots and POSTs so an earlier tab event cannot arrive after a
// later one and overwrite its domain. Every job obtains a fresh browser state.
function enqueue(job) {
  const result = serial.catch(() => {}).then(job);
  serial = result.catch(() => {});
  return result;
}

function updatePolling(needed) {
  if (needed && pollingTimer === null) {
    // On Chrome 110+, extension API calls reset the worker's idle timer. Each
    // poll calls storage/windows/tabs APIs; no offscreen page or DOM access is
    // needed, including for an arXiv PDF in the browser's own viewer.
    pollingTimer = setInterval(scheduleRefresh, 2000);
  } else if (!needed && pollingTimer !== null) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

async function saveStatus(status) {
  // Session storage is memory-only: do not persist a browsing log on disk.
  await chrome.storage.session.set({ [STATUS_KEY]: status });
}

async function readSnapshot() {
  try {
    const window = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    if (!window.focused || window.state === "minimized") return activitySnapshot(BROWSER, window);
    const tabs = await chrome.tabs.query({ active: true, windowId: window.id });
    return activitySnapshot(BROWSER, window, tabs[0]);
  } catch {
    return activitySnapshot(BROWSER);
  }
}

async function postSnapshot(token, snapshot) {
  const previous = (await chrome.storage.session.get(STATUS_KEY))[STATUS_KEY] || {};
  const status = {
    configured: true,
    connected: false,
    last_attempt: Date.now(),
    last_success: previous.last_success || null,
    domain: snapshot.domain,
    focused: snapshot.focused,
    error: null,
    browser: BROWSER,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(ACTIVITY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(snapshot),
      signal: controller.signal,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) {
      status.error = response.status === 401 || response.status === 403
        ? "配对码不匹配，请从桌面程序重新复制。"
        : `本机程序返回错误（HTTP ${response.status}）。`;
    } else {
      status.connected = true;
      status.last_success = Date.now();
    }
  } catch {
    status.error = "未连接到本机程序，请确认桌面程序正在运行。";
  } finally {
    clearTimeout(timeout);
  }
  await saveStatus(status);
  return status;
}

async function refresh() {
  const token = normalizeToken((await chrome.storage.local.get(TOKEN_KEY))[TOKEN_KEY]);
  if (!token) {
    updatePolling(false);
    const status = { configured: false, connected: false, browser: BROWSER, domain: null, error: null };
    await saveStatus(status);
    return status;
  }
  const snapshot = await readSnapshot();
  updatePolling(Boolean(snapshot.focused && snapshot.domain && !snapshot.incognito));
  return postSnapshot(token, snapshot);
}

function requestRefresh() {
  // One refresh may be running and at most one may be pending. Events arriving
  // during a fetch queue one fresh snapshot, never an old captured tab URL.
  if (pendingRefresh) return pendingRefresh;
  const result = enqueue(async () => {
    pendingRefresh = null;
    return refresh();
  });
  pendingRefresh = result;
  return result;
}

function scheduleRefresh() {
  void requestRefresh().catch(() => {});
}

async function ensureAlarm() {
  // Recover after browser/worker suspension. A suspended worker cannot promise
  // heartbeats: the desktop receiver deliberately expires its last snapshot.
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureAlarm().catch(() => {});
  scheduleRefresh();
});
chrome.runtime.onStartup.addListener(() => {
  void ensureAlarm().catch(() => {});
  scheduleRefresh();
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) scheduleRefresh();
});
chrome.windows.onFocusChanged.addListener(scheduleRefresh);
chrome.windows.onRemoved.addListener(scheduleRefresh);
chrome.tabs.onActivated.addListener(scheduleRefresh);
chrome.tabs.onRemoved.addListener(scheduleRefresh);
chrome.tabs.onUpdated.addListener((_tabId, changes) => {
  if (Object.hasOwn(changes, "url") || changes.status === "loading" || changes.status === "complete") scheduleRefresh();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  if (!isPopupSender(sender, chrome.runtime.id, chrome.runtime.getURL("popup.html"))) return false;
  if (message.type === "STUDYTIME_GET_STATUS") {
    void requestRefresh().then(sendResponse, () => sendResponse({ connected: false, error: "连接状态读取失败。" }));
    return true;
  }
  if (message.type === "STUDYTIME_SAVE_TOKEN") {
    const token = normalizeToken(message.token);
    if (!token) {
      sendResponse({ ok: false, error: "请输入桌面程序生成的完整配对码。" });
      return false;
    }
    void enqueue(async () => {
      await chrome.storage.local.set({ [TOKEN_KEY]: token });
      return { ok: true, status: await refresh() };
    }).then(sendResponse, () => sendResponse({ ok: false, error: "保存失败，请重试。" }));
    return true;
  }
  if (message.type === "STUDYTIME_DISCONNECT") {
    void enqueue(async () => {
      const token = normalizeToken((await chrome.storage.local.get(TOKEN_KEY))[TOKEN_KEY]);
      if (token) await postSnapshot(token, activitySnapshot(BROWSER));
      await chrome.storage.local.remove(TOKEN_KEY);
      return { ok: true, status: await refresh() };
    }).then(sendResponse, () => sendResponse({ ok: false, error: "断开失败，请重试。" }));
    return true;
  }
  return false;
});

// Browser updates may clear alarms. Recreating the named alarm is idempotent.
void ensureAlarm().catch(() => {});
