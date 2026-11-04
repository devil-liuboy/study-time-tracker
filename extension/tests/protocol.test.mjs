import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_ENDPOINT, hostnameOnly, normalizeToken, browserKind,
  isPopupSender, activitySnapshot,
} from "../protocol.mjs";

test("outbound host extraction removes paths, credentials, ports, search and fragments", () => {
  assert.equal(hostnameOnly("https://alice:password@GitHub.com:443/org/private?secret=abc#secret"), "github.com");
  assert.equal(hostnameOnly("https://ARXIV.ORG./pdf/1234.5678"), "arxiv.org");
  assert.equal(hostnameOnly("https://github.com.example.org/path"), "github.com.example.org");
  assert.equal(hostnameOnly("https://github.com@evil.example/path"), "evil.example");
});

test("internal, local-file, data and malformed URL schemes never become domains", () => {
  for (const url of ["chrome://newtab", "edge://settings", "file:///C:/secret.pdf", "data:text/html,secret", "javascript:alert(1)", "blob:https://github.com/abc", "about:blank", "not a URL", "", null]) {
    assert.equal(hostnameOnly(url), null);
  }
});

test("only a focused normal window's active non-incognito tab yields a domain", () => {
  const window = { id: 10, focused: true, type: "normal", state: "normal", left: -1000, top: 0, width: 1000, height: 700 };
  const tab = { id: 20, windowId: 10, active: true, incognito: false, url: "https://arxiv.org/pdf/secret" };
  const active = activitySnapshot("edge", window, tab);
  assert.equal(active.domain, "arxiv.org");
  assert.equal(active.browser, "edge");
  assert.deepEqual(active.window_bounds, { left: -1000, top: 0, width: 1000, height: 700 });
  for (const change of [{ focused: false }, { type: "popup" }, { state: "minimized" }, { incognito: true }]) {
    assert.equal(activitySnapshot("chrome", { ...window, ...change }, tab).domain, null);
  }
  for (const change of [{ active: false }, { windowId: 11 }, { incognito: true }, { url: "chrome://settings" }]) {
    assert.equal(activitySnapshot("chrome", window, { ...tab, ...change }).domain, null);
  }
  assert.equal(activitySnapshot("chrome").domain, null);
  assert.equal(activitySnapshot("chrome").focused, false);
});

test("serialized snapshot contains no URL, title, content or arbitrary tab properties", () => {
  const snapshot = activitySnapshot("chrome", { id: 1, focused: true, type: "normal" }, {
    windowId: 1, active: true, url: "https://github.com/private-repo?secret", title: "private title", body: "private body", password: "secret",
  });
  assert.deepEqual(Object.keys(snapshot).sort(), ["browser", "domain", "focused", "incognito", "window_bounds", "window_id"]);
  assert.equal(JSON.stringify(snapshot).includes("private"), false);
  assert.equal(JSON.stringify(snapshot).includes("secret"), false);
});

test("web pages and content scripts cannot invoke popup-only pairing controls", () => {
  const url = "chrome-extension://our-extension/popup.html";
  assert.equal(isPopupSender({ id: "our-extension", url }, "our-extension", url), true);
  assert.equal(isPopupSender({ id: "our-extension", url, tab: { id: 1 } }, "our-extension", url), false);
  assert.equal(isPopupSender({ id: "our-extension", url: "https://github.com" }, "our-extension", url), false);
  assert.equal(isPopupSender({ id: "other-extension", url }, "our-extension", url), false);
});

test("pairing accepts only sufficiently long hex tokens and has a fixed local destination", () => {
  assert.equal(normalizeToken("  " + "ab".repeat(32) + "  "), "ab".repeat(32));
  for (const token of ["abc", "g".repeat(64), "abc\r\nAuthorization: other", "a".repeat(33), null]) assert.equal(normalizeToken(token), null);
  assert.equal(ACTIVITY_ENDPOINT, "http://127.0.0.1:47831/v1/activity");
  assert.equal(browserKind("Mozilla/5.0 Chrome/130.0 Edg/130.0"), "edge");
  assert.equal(browserKind("Mozilla/5.0 Chrome/130.0"), "chrome");
});
