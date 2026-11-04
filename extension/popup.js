const elements = Object.fromEntries([
  "status-dot", "status-label", "status-detail", "browser", "current-domain", "last-success",
  "pair-form", "pair-token", "connect", "disconnect", "feedback",
].map(id => [id, document.getElementById(id)]));
let busy = false;

function showStatus(status = {}) {
  elements.browser.textContent = status.browser === "edge" ? "Edge" : "Chrome";
  elements["status-dot"].className = `dot${status.connected ? " connected" : status.configured ? " warning" : ""}`;
  elements["status-label"].textContent = status.connected ? "已连接本机" : status.configured ? "等待桌面程序" : "尚未配对";
  elements["status-detail"].textContent = status.error || (status.connected ? "连接正常，具体计时状态请查看桌面程序。" : "在下方粘贴桌面程序提供的配对码。");
  elements["current-domain"].textContent = status.domain || "当前无可报告网页";
  elements["last-success"].textContent = status.last_success
    ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(status.last_success))
    : "—";
  elements["pair-token"].placeholder = status.configured ? "已保存；输入新配对码可更换" : "粘贴桌面程序提供的配对码";
  elements.disconnect.hidden = !status.configured;
}

function feedback(text, error = false) {
  elements.feedback.textContent = text;
  elements.feedback.className = `feedback${error ? " error" : ""}`;
}

function setBusy(value) {
  busy = value;
  elements.connect.disabled = value;
  elements.disconnect.disabled = value;
}

async function refresh() {
  if (busy) return;
  try {
    showStatus(await chrome.runtime.sendMessage({ type: "STUDYTIME_GET_STATUS" }));
  } catch {
    feedback("扩展暂时未响应，请关闭此窗口后重新打开。", true);
  }
}

elements["pair-form"].addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  setBusy(true);
  feedback("");
  try {
    const result = await chrome.runtime.sendMessage({ type: "STUDYTIME_SAVE_TOKEN", token: elements["pair-token"].value });
    if (!result?.ok) feedback(result?.error || "配对失败，请重试。", true);
    else {
      elements["pair-token"].value = "";
      showStatus(result.status);
      feedback(result.status.connected ? "配对成功。计时结果请查看桌面程序。" : "配对码已保存；桌面程序启动后会自动重试。", !result.status.connected);
    }
  } catch {
    feedback("保存失败，请重新打开扩展后重试。", true);
  } finally {
    setBusy(false);
  }
});

elements.disconnect.addEventListener("click", async () => {
  if (busy) return;
  setBusy(true);
  try {
    const result = await chrome.runtime.sendMessage({ type: "STUDYTIME_DISCONNECT" });
    if (!result?.ok) feedback(result?.error || "断开失败。", true);
    else {
      elements["pair-token"].value = "";
      showStatus(result.status);
      feedback("已断开并清除配对码。浏览器时间将停止上报。");
    }
  } catch {
    feedback("断开失败，请重试。", true);
  } finally {
    setBusy(false);
  }
});

void refresh();
setInterval(() => void refresh(), 2000);
