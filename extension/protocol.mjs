// All network destinations are fixed here. Never accept a server URL from a page.
export const ACTIVITY_ENDPOINT = "http://127.0.0.1:47831/v1/activity";
export const TOKEN_KEY = "studytime_pair_token";
export const STATUS_KEY = "studytime_connection_status";

export function normalizeToken(value) {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return /^(?:[0-9a-f]{2}){16,64}$/i.test(token) ? token : null;
}

export function hostnameOnly(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname.toLowerCase().replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

export function browserKind(userAgent) {
  return /\bEdg\//.test(userAgent || "") ? "edge" : "chrome";
}

export function isPopupSender(sender, extensionId, popupUrl) {
  return Boolean(sender && sender.id === extensionId && !sender.tab && sender.url === popupUrl);
}

function windowBounds(window) {
  const keys = ["left", "top", "width", "height"];
  if (!window || !keys.every(key => Number.isFinite(window[key]))) return null;
  if (window.width <= 0 || window.height <= 0) return null;
  return Object.fromEntries(keys.map(key => [key, Math.round(window[key])]));
}

export function activitySnapshot(browser, window = null, tab = null) {
  const focused = Boolean(window?.focused && window.type === "normal" && window.state !== "minimized");
  const incognito = Boolean(window?.incognito || tab?.incognito);
  const active = Boolean(tab?.active && tab.windowId === window?.id);
  return {
    domain: focused && active && !incognito ? hostnameOnly(tab.url) : null,
    browser: browser === "edge" ? "edge" : "chrome",
    focused,
    window_id: Number.isInteger(window?.id) ? window.id : -1,
    incognito,
    // Chromium coordinates are device-independent pixels, not physical pixels.
    window_bounds: windowBounds(window),
  };
}
