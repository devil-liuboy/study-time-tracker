import math

import pytest

from studytime.engine import Engine
from studytime.store import Store, day_bounds


APP = {"id": "code.exe", "name": "VS Code", "kind": "app", "category": "编程"}
PAPER = {"id": "arxiv.org", "name": "arXiv", "kind": "website", "category": "论文"}


@pytest.fixture
def timer():
    store = Store(":memory:")
    engine = Engine(store)
    yield engine, store
    store.close()


def total(engine, store, start=0, end=1000):
    return store.report(start, end, engine.pending())


def test_pending_time_is_visible_but_not_persisted_until_next_input(timer):
    engine, store = timer
    engine.tick(0, 0, APP)
    for second in range(1, 11):
        engine.tick(second, second, APP)
    result = total(engine, store)
    assert result["total_seconds"] == 10
    assert result["confirmed_seconds"] == 0
    assert result["pending_seconds"] == 10
    engine.tick(11, 0.25, APP)
    result = total(engine, store)
    assert result["confirmed_seconds"] == 10.75
    assert result["pending_seconds"] == 0.25


def test_180_second_idle_rolls_back_across_apps(timer):
    engine, store = timer
    engine.tick(0, 0, APP)
    for second in range(1, 180):
        engine.tick(second, second, PAPER if second >= 70 else APP)
    result = total(engine, store)
    assert result["total_seconds"] == 179
    assert {item["name"] for item in result["items"]} == {"VS Code", "arXiv"}
    state = engine.tick(180, 180, PAPER)
    assert state["state"] == "idle"
    assert state["rolled_back_seconds"] == 180
    assert total(engine, store)["total_seconds"] == 0


def test_confirmed_time_survives_later_idle(timer):
    engine, store = timer
    for second in range(11):
        engine.tick(second, 0, APP)
    for second in range(11, 191):
        engine.tick(second, second - 10, APP)
    result = total(engine, store)
    assert result["confirmed_seconds"] == 10
    assert result["pending_seconds"] == 0


def test_input_after_threshold_between_polls_cannot_rescue_idle(timer):
    engine, store = timer
    engine.tick(0, 0, APP)
    for second in range(1, 180):
        engine.tick(second, second, APP)
    engine.tick(181, 0.8, APP)  # New input at 180.2, after the deadline.
    result = total(engine, store)
    assert result["confirmed_seconds"] == 0
    assert result["pending_seconds"] == pytest.approx(0.8)
    engine.tick(182, 0, APP)
    assert total(engine, store)["confirmed_seconds"] == pytest.approx(1.8)


def test_resume_after_idle_starts_at_input_not_last_poll(timer):
    engine, store = timer
    engine.tick(0, 0, APP)
    for second in range(1, 182):
        engine.tick(second, second, APP)
    engine.tick(182, 0.2, APP)
    assert total(engine, store)["pending_seconds"] == pytest.approx(0.2)


def test_previous_foreground_source_owns_interval(timer):
    engine, store = timer
    engine.tick(0, 0, APP)
    engine.tick(1, 0, PAPER)
    engine.tick(2, 0, None)
    engine.tick(3, 0, None)
    result = total(engine, store)
    assert {item["id"]: item["seconds"] for item in result["items"]} == {
        "code.exe": 1, "arxiv.org": 1,
    }


def test_pause_does_not_flush_or_extend_pending(timer):
    engine, store = timer
    engine.tick(0, 0, APP)
    engine.tick(1, 1, APP)
    engine.tick(2, 2, APP, blocked=True)
    assert total(engine, store)["confirmed_seconds"] == 0
    assert total(engine, store)["pending_seconds"] == 1
    for second in range(3, 181):
        engine.tick(second, second, APP, blocked=True)
    assert total(engine, store)["total_seconds"] == 0


def test_short_pause_keeps_only_observed_eligible_time(timer):
    engine, store = timer
    engine.tick(0, 0, APP)
    engine.tick(1, 1, APP)
    engine.tick(2, 2, APP, blocked=True)
    engine.tick(3, 0, APP, blocked=True)
    engine.tick(4, 1, APP)
    engine.tick(5, 0, APP)
    result = total(engine, store)
    assert result["total_seconds"] == 2


def test_sleep_sampling_gap_discards_tail_and_does_not_backfill(timer):
    engine, store = timer
    engine.tick(0, 0, APP)
    engine.tick(1, 1, APP)
    state = engine.tick(90, 0, APP)
    assert state["sampling_gap"]
    assert total(engine, store)["total_seconds"] == 0
    engine.tick(91, 0, APP)
    assert total(engine, store)["confirmed_seconds"] == 1


def test_midnight_pending_and_committed_split_beijing_days(timer):
    engine, store = timer
    start, midnight = day_bounds("2026-11-03")
    engine.tick(midnight - 2, 0, APP)
    engine.tick(midnight - 1, 1, APP)
    engine.tick(midnight, 2, APP)
    engine.tick(midnight + 1, 0, APP)
    result = total(engine, store, start, midnight + 86400)
    assert result["daily"] == [
        {"date": "2026-11-03", "seconds": 2},
        {"date": "2026-11-04", "seconds": 1},
    ]


def test_input_sampling_jitter_does_not_confirm_inactivity(timer):
    engine, store = timer
    engine.tick(0, 0, APP)
    engine.tick(1.001, 1, APP)
    engine.tick(2.003, 2, APP)
    assert total(engine, store)["confirmed_seconds"] == 0
    assert total(engine, store)["pending_seconds"] == pytest.approx(2.003)


def test_clock_rollback_and_shutdown_never_duplicate_pending(timer):
    engine, store = timer
    engine.tick(100, 0, APP)
    engine.tick(101, 1, APP)
    engine.tick(99, 2, APP)
    assert engine.pending() == []
    engine.tick(100, 3, APP)
    assert engine.discard_pending() == 1
    assert store.report(0, 1000)["total_seconds"] == 0


def test_pending_snapshot_does_not_mutate_engine(timer):
    engine, _ = timer
    engine.tick(0, 0, APP)
    engine.tick(1, 1, APP)
    external = engine.pending()
    external[0]["end"] = 9000
    external[0]["source"]["name"] = "changed"
    assert engine.pending()[0]["end"] == 1
    assert engine.pending()[0]["source"]["name"] == "VS Code"


def test_failed_observation_cannot_backfill_previous_source_on_recovery(timer):
    engine, store = timer
    engine.tick(0, 0, APP)
    engine.tick(1, 1, APP)
    assert engine.break_observation() == 1
    assert engine.status["state"] == "blocked"
    assert engine.status["source"] is None
    engine.tick(3, 0, APP)
    assert total(engine, store)["total_seconds"] == 0
    engine.tick(4, 0, APP)
    assert total(engine, store)["confirmed_seconds"] == 1


@pytest.mark.parametrize("now,idle", [(math.inf, 0), (0, math.nan), (0, -1)])
def test_invalid_clock_observations_rejected(timer, now, idle):
    with pytest.raises(ValueError):
        timer[0].tick(now, idle, APP)
