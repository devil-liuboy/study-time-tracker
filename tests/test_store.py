import math
import sqlite3

import pytest

from studytime.store import Store, day_bounds


APP = {"id": "code.exe", "name": "VS Code", "kind": "app", "category": "编程"}
SITE = {"id": "github.com", "name": "GitHub", "kind": "website", "category": "代码"}


@pytest.fixture
def store():
    result = Store(":memory:")
    yield result
    result.close()


def test_adjacent_same_source_coalesces_and_filters_range(store):
    store.add_interval(0, 10, APP)
    store.add_interval(10, 20, APP)
    report = store.report(5, 15)
    assert report["confirmed_seconds"] == 10
    assert len(report["sessions"]) == 1
    assert report["sessions"][0]["start"] == 5
    assert report["sessions"][0]["end"] == 15


def test_overlap_rejected_without_partial_write(store):
    store.add_interval(0, 10, APP)
    with pytest.raises(ValueError, match="重叠"):
        store.add_interval(9, 20, SITE)
    assert store.report(0, 100)["total_seconds"] == 10


def test_midnight_split_and_empty_days(store):
    start, midnight = day_bounds("2026-11-03")
    store.add_interval(midnight - 10, midnight + 20, APP)
    report = store.report(start, midnight + 2 * 86400)
    assert report["daily"] == [
        {"date": "2026-11-03", "seconds": 10},
        {"date": "2026-11-04", "seconds": 20},
        {"date": "2026-11-05", "seconds": 0},
    ]
    assert len(report["sessions"]) == 2


def test_persistence_and_no_sensitive_columns(tmp_path):
    path = tmp_path / "data.sqlite3"
    store = Store(path)
    store.add_interval(0, 12, APP)
    store.close()
    reopened = Store(path)
    assert reopened.report(0, 30)["total_seconds"] == 12
    reopened.close()
    with sqlite3.connect(path) as db:
        names = {row[1] for row in db.execute("PRAGMA table_info(sessions)")}
    assert not names.intersection({"url", "title", "keys", "keystrokes", "path"})


def test_pending_clipped_and_never_written(store):
    report = store.report(0, 10, [{"start": 5, "end": 20, "source": SITE}])
    assert report["pending_seconds"] == 5
    assert report["confirmed_seconds"] == 0
    assert report["items"][0]["pending_seconds"] == 5
    assert store.report(0, 30)["total_seconds"] == 0


def test_manual_positive_negative_are_visible_and_reversible(store):
    start, end = day_bounds("2026-11-04")
    store.add_interval(start + 100, start + 700, APP)
    addition = store.add_manual("2026-11-04", 60, "阅读补记", "阅读")
    deduction = store.add_manual("2026-11-04", -120, "误计修正")
    report = store.report(start, end)
    assert report["confirmed_seconds"] == 540
    assert sorted(x["seconds"] for x in report["sessions"] if x["manual"]) == [-120, 60]
    store.delete_manual(deduction)
    store.delete_manual(addition)
    assert store.report(start, end)["confirmed_seconds"] == 600


def test_manual_deduction_cannot_make_negative_or_use_pending(store):
    with pytest.raises(ValueError, match="0 到 24"):
        store.add_manual("2026-11-04", -1)
    store.add_manual("2026-11-04", 86400)
    with pytest.raises(ValueError, match="0 到 24"):
        store.add_manual("2026-11-04", 1)


def test_cannot_delete_automatic_entry_or_break_dependent_adjustments(store):
    start, end = day_bounds("2026-11-04")
    store.add_interval(start, start + 10, APP)
    entry = store.report(start, end)["sessions"][0]["id"]
    with pytest.raises(ValueError, match="只能"):
        store.delete_manual(entry)
    addition = store.add_manual("2026-11-04", 100)
    deduction = store.add_manual("2026-11-04", -100)
    with pytest.raises(ValueError, match="依赖"):
        store.delete_manual(addition)
    store.delete_manual(deduction)
    store.delete_manual(addition)


@pytest.mark.parametrize("seconds", [math.nan, math.inf, 0, 86401])
def test_bad_manual_values_rejected(store, seconds):
    with pytest.raises(ValueError):
        store.add_manual("2026-11-04", seconds)


def test_bad_date_and_control_characters_rejected(store):
    with pytest.raises(ValueError):
        store.add_manual("2026-02-30", 30)
    with pytest.raises(ValueError):
        store.add_manual("2026-11-04", 30, "line\nbreak")
