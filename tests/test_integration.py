"""Meaningful integration boundaries; no installed app or browser history read."""

import csv
from datetime import datetime
import sys
from types import SimpleNamespace

import pytest

from studytime.config import Config, SITES, app_id, is_video, matches_domain, normalize_domain
from studytime.discovery import classify
from studytime.service import Service, TZ, report_bounds
from studytime.store import day_bounds
import studytime.windows as windows_module
import studytime.service as service_module


@pytest.fixture
def service(tmp_path):
    result = Service(tmp_path / "data", tmp_path, test_mode=True)
    yield result
    result.browser.stop()
    result.store.close()


def allow_app(service, path, **extra):
    record = {"path": str(path), "name": "Editor", "category": "编程", "enabled": True, **extra}
    service.config.update_apps([record])
    return service.config.snapshot()["apps"][0]


def snapshot(path, now=0, idle=0, changed=0, blocked=False):
    return {"path": str(path), "now": now, "idle_seconds": idle, "changed": changed, "blocked": blocked, "hwnd": 1}


def test_app_matching_uses_full_path_and_respects_disabled(service, tmp_path):
    actual = tmp_path / "editor" / "Code.exe"
    allow_app(service, actual)
    assert service._source(snapshot(actual))["name"] == "Editor"
    assert service._source(snapshot(tmp_path / "unrelated" / "Code.exe")) is None
    allow_app(service, actual, enabled=False)
    assert service._source(snapshot(actual)) is None


def test_browser_only_counts_whitelist_and_video_deny_wins(service, tmp_path):
    foreground = snapshot(tmp_path / "chrome.exe")
    service.browser.accept({"browser": "chrome", "focused": True, "domain": "arxiv.org"})
    assert service._source(foreground)["kind"] == "website"
    for domain in ("evilgithub.com", "github.com.attacker.example", "bilibili.com", "news.example"):
        service.browser.accept({"browser": "chrome", "focused": True, "domain": domain})
        assert service._source(foreground) is None
    service.browser.accept({"browser": "chrome", "focused": True, "domain": "docs.pytorch.org"})
    assert service._source(foreground)["name"] == "pytorch.org"
    # Even a directly manipulated/old config cannot override the video deny.
    service.config.data["websites"].append({"domain": "youtube.com", "category": "学习", "enabled": True})
    service.browser.accept({"browser": "chrome", "focused": True, "domain": "www.youtube.com"})
    assert service._source(foreground) is None


def test_browser_does_not_leak_into_foreground_desktop_or_other_browser(service, tmp_path):
    service.browser.accept({"browser": "chrome", "focused": True, "domain": "github.com"})
    assert service._source(snapshot(tmp_path / "unknown.exe")) is None
    assert service._source(snapshot(tmp_path / "msedge.exe")) is None
    assert service._source(snapshot(tmp_path / "firefox.exe")) is None


def test_browser_cannot_be_whitelisted_as_entire_app(service, tmp_path):
    with pytest.raises(ValueError, match="浏览器"):
        allow_app(service, tmp_path / "chrome.exe")


def test_failed_monitor_sample_breaks_observation_not_just_pending(service, tmp_path):
    path = tmp_path / "code.exe"
    allow_app(service, path)
    source = service._source(snapshot(path))
    service.engine.tick(0, 0, source)
    service.engine.tick(1, 1, source)

    class StopAfterTwo:
        calls = 0
        def is_set(self):
            return self.calls >= 2
        def wait(self, seconds):
            self.calls += 1

    stop = StopAfterTwo()
    def observe():
        if stop.calls == 0:
            raise RuntimeError("temporary access failure")
        return snapshot(path, now=3, idle=0)
    service.stop_event = stop
    service.observer = SimpleNamespace(snapshot=observe)
    service._monitor()
    result = service.store.report(0, 10, service.engine.pending())
    assert result["total_seconds"] == 0, "failed sample interval was backfilled from stale foreground"


def test_manual_pause_takes_effect_before_next_tick(service, tmp_path):
    path = tmp_path / "code.exe"
    allow_app(service, path)
    source = service._source(snapshot(path))
    service.engine.tick(0, 0, source)
    service.engine.tick(1, 1, source)
    service.observer = SimpleNamespace(snapshot=lambda: snapshot(path, now=1.5, idle=1.5))
    assert service.set_paused(True)["paused"]
    assert service.engine.status["state"] == "blocked"
    service.engine.tick(2, 2, source, blocked=service.paused)
    assert service.engine.status["pending_seconds"] == 1


def test_default_sites_are_exact_confirmed_set_and_defensive_copy(tmp_path):
    config = Config(tmp_path)
    sites = config.snapshot()["websites"]
    assert len(sites) == 19
    assert {entry["domain"] for entry in sites} == {domain for group in SITES.values() for domain in group}
    sites.clear()
    assert len(config.snapshot()["websites"]) == 19
    config_again = Config(tmp_path)
    assert config_again.token == config.token
    assert len(config.token) == 64


@pytest.mark.parametrize("domain", ["https://github.com", "github.com/path", "github.com:443", "*.github.com", "user@github.com", "github..com", "-github.com", "github"])
def test_bad_site_rules_rejected(domain):
    with pytest.raises(ValueError):
        normalize_domain(domain)


def test_site_normalization_boundary_and_video_rules(tmp_path):
    assert normalize_domain("  GitHub.COM.  ") == "github.com"
    assert matches_domain("docs.github.com", "github.com")
    assert not matches_domain("evilgithub.com", "github.com")
    assert is_video("www.bilibili.com")
    config = Config(tmp_path)
    with pytest.raises(ValueError, match="视频"):
        config.update_websites([{"domain": "youtube.com"}])
    assert len(config.snapshot()["websites"]) == 19  # failed update is atomic


def test_empty_category_does_not_make_valid_app_unrecordable(service, tmp_path):
    allow_app(service, tmp_path / "code.exe", category="")
    source = service._source(snapshot(tmp_path / "code.exe"))
    assert source["category"].strip()
    service.engine.tick(0, 0, source)
    service.engine.tick(1, 0, source)
    assert service.store.report(0, 10)["confirmed_seconds"] == 1


def test_app_control_characters_rejected_at_settings_boundary(service, tmp_path):
    with pytest.raises(ValueError):
        allow_app(service, tmp_path / "code.exe", name="Editor\nInjected")


def test_discovery_does_not_label_plain_chatgpt_as_codex():
    assert classify("ChatGPT", "chatgpt.exe") is None
    assert classify("OpenAI.Codex", "chatgpt.exe")[0] == "Codex"
    assert classify("Unrelated", "random.exe") is None
    assert classify("Visual Studio Code", "Code.exe")[0] == "VS Code"


@pytest.mark.skipif(sys.platform != "win32", reason="Windows package path semantics")
def test_msix_identity_and_matching_survive_version_upgrade(service):
    old = r"C:\Program Files\WindowsApps\OpenAI.Codex_1.0.0.0_x64__2p2nqsd0c76g0\app\chatgpt.exe"
    new = r"C:\Program Files\WindowsApps\OpenAI.Codex_2.0.0.0_x64__2p2nqsd0c76g0\app\chatgpt.exe"
    family = "OpenAI.Codex_2p2nqsd0c76g0"
    assert app_id(old, family) == app_id(new, family)
    allow_app(service, old, package_family=family)
    assert service._source(snapshot(new))["name"] == "Editor"
    impostor = new.replace("2p2nqsd0c76g0", "differentpublisher")
    assert service._source(snapshot(impostor)) is None


def test_beijing_custom_bounds_and_invalid_window():
    start, end = report_bounds({"range": "custom", "start": "2026-11-04", "end": "2026-11-04"})
    assert (start, end) == day_bounds("2026-11-04")
    assert datetime.fromtimestamp(start, TZ).hour == 0
    with pytest.raises(ValueError):
        report_bounds({"range": "custom", "start": "2026-11-05", "end": "2026-11-04"})


def test_manual_future_validation_changes_exactly_at_beijing_midnight(service, monkeypatch):
    clock = [datetime.fromisoformat("2026-11-03T15:59:59+00:00")]

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            assert tz is TZ, "Manual-date validation must explicitly use Beijing time"
            return clock[0].astimezone(tz)

    monkeypatch.setattr(service_module, "datetime", FrozenDateTime)
    start, end = day_bounds("2026-11-04")
    value = {"date": "2026-11-04", "minutes": 1, "name": "阅读补记"}
    denied = service.add_manual(value)
    assert "北京时间今天" in denied["error"]
    assert service.store.report(start, end)["total_seconds"] == 0
    clock[0] = datetime.fromisoformat("2026-11-03T16:00:00+00:00")
    assert service.add_manual(value)["ok"] is True
    assert service.store.report(start, end)["confirmed_seconds"] == 60
    assert service.add_manual({**value, "date": "2026-11-03"})["ok"] is True


def test_service_rejects_new_future_corrections_without_rewriting_existing_storage(service, monkeypatch):
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.fromisoformat("2026-11-04T12:00:00+08:00").astimezone(tz)

    monkeypatch.setattr(service_module, "datetime", FrozenDateTime)
    future_date = "2026-11-05"
    original_id = service.store.add_manual(future_date, 120, "既有记录")
    denied = service.add_manual({"date": future_date, "minutes": -1, "name": "未来扣减"})
    assert "北京时间今天" in denied["error"]
    start, end = day_bounds(future_date)
    report = service.store.report(start, end)
    assert report["confirmed_seconds"] == 120
    assert [row["id"] for row in report["sessions"]] == [original_id]


def test_csv_is_confirmed_only_and_escapes_formula_names(service, tmp_path, monkeypatch):
    export = tmp_path / "export.csv"
    service.window = SimpleNamespace(create_file_dialog=lambda *args, **kwargs: (str(export),))
    monkeypatch.setitem(sys.modules, "webview", SimpleNamespace(FileDialog=SimpleNamespace(SAVE=1)))
    start, end = day_bounds("2026-11-04")
    source = {"id": "app:test", "name": "=HYPERLINK(1)", "kind": "app", "category": "@Category"}
    service.store.add_interval(start + 1, start + 31, source)
    service.engine.tick(start + 40, 0, source)
    service.engine.tick(start + 41, 1, source)
    result = service.export_csv({"range": "custom", "start": "2026-11-04", "end": "2026-11-04"})
    assert result["ok"]
    with export.open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.reader(stream))
    assert len(rows) == 2
    assert rows[1][2] == "'=HYPERLINK(1)"
    assert rows[1][4] == "'@Category"
    assert float(rows[1][5]) == 30


@pytest.mark.skipif(sys.platform != "win32", reason="Win32 observation adapter")
@pytest.mark.parametrize("unlocked,readable,input_ok", [(True, True, True), (False, True, True), (True, False, True), (True, True, False)])
def test_win32_observer_handles_tick_wrap_and_fails_closed(monkeypatch, unlocked, readable, input_ok):
    class User32:
        def GetLastInputInfo(self, pointer):
            pointer._obj.dwTime = 0xFFFFFF00
            return input_ok
        def OpenInputDesktop(self, *args):
            return 1
        def SwitchDesktop(self, desktop):
            return unlocked
        def CloseDesktop(self, desktop):
            pass
        def GetForegroundWindow(self):
            return 123
        def GetWindowThreadProcessId(self, hwnd, pointer):
            pointer._obj.value = 456

    class Kernel32:
        def GetTickCount64(self):
            return (1 << 32) + 1234
        def OpenProcess(self, *args):
            return 1 if readable else 0
        def QueryFullProcessImageNameW(self, process, flags, buffer, size):
            buffer.value = r"C:\Apps\Editor\Code.exe"
            return True
        def CloseHandle(self, process):
            pass

    monkeypatch.setattr(windows_module, "user32", User32())
    monkeypatch.setattr(windows_module, "kernel32", Kernel32())
    sample = windows_module.Observer().snapshot()
    assert sample["idle_seconds"] == pytest.approx(1.49)
    assert sample["blocked"] is not (unlocked and readable and input_ok)
    assert not {"title", "keys", "url", "content"}.intersection(sample)
