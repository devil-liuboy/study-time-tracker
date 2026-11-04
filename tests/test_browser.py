"""Regression checks for browser focus, privacy, expiry, and loopback access."""

import http.client
import json

import pytest

import studytime.browser as browser_module
from studytime.browser import BrowserBridge


TOKEN = "a" * 64
ACTIVITY = {"browser": "chrome", "domain": "arxiv.org", "focused": True, "incognito": False}


def test_browser_current_requires_recent_report_after_native_focus(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(browser_module.time, "monotonic", lambda: clock[0])
    bridge = BrowserBridge(TOKEN)
    bridge.accept(ACTIVITY)
    assert bridge.current("chrome", 99) == "arxiv.org"
    assert bridge.current("chrome", 101) is None
    assert bridge.current("edge", 99) is None
    clock[0] = 105.01
    assert bridge.current("chrome") is None


@pytest.mark.parametrize("change", [
    {"focused": False}, {"incognito": True}, {"domain": None},
    {"focused": "true"},
])
def test_unfocused_private_and_unresolved_pages_fail_closed(change):
    bridge = BrowserBridge(TOKEN)
    bridge.accept(ACTIVITY)
    bridge.accept({**ACTIVITY, **change})
    assert bridge.current("chrome") is None


def test_explicit_nonlearning_navigation_replaces_old_site():
    bridge = BrowserBridge(TOKEN)
    bridge.accept(ACTIVITY)
    bridge.accept({**ACTIVITY, "domain": "bilibili.com"})
    assert bridge.current("chrome") == "bilibili.com"
    # The bridge reports the current host; Service's permanent video deny wins.


@pytest.mark.parametrize("payload", [
    [], {"browser": "firefox", "domain": "arxiv.org"},
    {**ACTIVITY, "domain": "https://arxiv.org/abs/private"},
    {**ACTIVITY, "domain": "arxiv.org:443"},
    {**ACTIVITY, "domain": "arxiv.org@attacker.example"},
])
def test_activity_payload_cannot_carry_urls_or_unknown_browsers(payload):
    with pytest.raises(ValueError):
        BrowserBridge(TOKEN).accept(payload)


@pytest.fixture
def http_bridge():
    bridge = BrowserBridge(TOKEN)
    try:
        port = bridge.start(0)
    except OSError as exc:
        pytest.skip(f"Local loopback binding unavailable in this environment: {exc}")
    yield bridge, port
    bridge.stop()


def request(port, method="POST", path="/v1/activity", body=ACTIVITY, headers=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
    supplied = {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}
    supplied.update(headers or {})
    encoded = json.dumps(body) if not isinstance(body, str) else body
    connection.request(method, path, body=encoded if method == "POST" else None, headers=supplied)
    response = connection.getresponse()
    result = response.status, json.loads(response.read())
    connection.close()
    return result


def test_http_authenticated_activity_and_health(http_bridge):
    bridge, port = http_bridge
    assert request(port)[0] == 200
    assert bridge.current("chrome") == "arxiv.org"
    assert request(port, method="GET", path="/health")[0] == 200


@pytest.mark.parametrize("headers", [
    {"Authorization": ""}, {"Authorization": "Bearer incorrect"},
    {"Origin": "https://evil.example"}, {"Host": "evil.example"},
])
def test_http_denies_web_pages_wrong_tokens_and_dns_rebinding(http_bridge, headers):
    bridge, port = http_bridge
    # Repeated small POST rejection used to reset Windows sockets because the
    # server closed them with unread bodies, intermittently hiding the 403.
    for _ in range(5):
        assert request(port, headers=headers)[0] == 403
        assert bridge.current("chrome") is None
    assert request(port)[0] == 200


def test_http_extension_origin_allowed_and_bad_json_rejected(http_bridge):
    bridge, port = http_bridge
    assert request(port, headers={"Origin": "chrome-extension://" + "a" * 32})[0] == 200
    assert request(port, body="{broken")[0] == 400
    assert request(port, path="/arbitrary")[0] == 404
