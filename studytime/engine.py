"""A conservative foreground timer with a reversible current idle spell.

Only observed intervals are counted. The interval after the latest input stays
in memory until another input validates it. At 180 seconds of inactivity that
entire spell is discarded. Unconfirmed time is also discarded on shutdown.
No keyboard contents, window titles, or URLs enter this module.
"""

from __future__ import annotations

import math
from copy import deepcopy
from typing import Any


def _finite(value: float, label: str) -> float:
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(f"{label} must be finite")
    return value


class Engine:
    """Call ``tick`` with a system-wide last-input age every second.

    Sources are dictionaries with id, name, kind (app/website), and category.
    The previous observation owns the interval up to the next observation.
    A current blocked observation suppresses the boundary interval too, which
    avoids crediting a lock/pause boundary whose exact time is not observable.
    The caller serializes calls to this object; Store has its own lock.
    """

    INPUT_EPSILON = 0.025  # Ignore wall-clock/tick-counter sampling jitter.

    def __init__(self, store: Any, idle_limit: float = 180, max_gap: float = 5):
        self.store = store
        self.idle_limit = _finite(idle_limit, "idle_limit")
        self.max_gap = _finite(max_gap, "max_gap")
        if self.idle_limit <= 0 or self.max_gap <= 0:
            raise ValueError("Limits must be positive")
        self._previous: dict | None = None
        self._last_input: float | None = None
        self._pending: list[dict] = []
        self.status = {
            "state": "starting", "idle_seconds": 0.0,
            "pending_seconds": 0.0, "source": None,
            "rolled_back_seconds": 0.0, "committed_seconds": 0.0,
            "sampling_gap": False,
        }

    @staticmethod
    def _source(source: dict | None) -> dict | None:
        if source is None:
            return None
        if source.get("kind") not in ("app", "website"):
            raise ValueError("Source kind must be app or website")
        result = {key: str(source.get(key, "")) for key in ("id", "name", "kind", "category")}
        if not result["id"] or not result["name"]:
            raise ValueError("Source id and name are required")
        return result

    def _append(self, start: float, end: float, source: dict) -> None:
        if end <= start:
            return
        if (self._pending and self._pending[-1]["source"] == source
                and abs(self._pending[-1]["end"] - start) < 1e-6):
            self._pending[-1]["end"] = end
        else:
            self._pending.append({"start": start, "end": end, "source": dict(source)})

    def _commit_through(self, moment: float) -> float:
        committed = 0.0
        # Remove each successfully persisted piece immediately. If a later
        # database write fails, retrying must not insert earlier pieces twice.
        while self._pending and self._pending[0]["start"] < moment:
            entry = self._pending[0]
            end = min(entry["end"], moment)
            if end > entry["start"]:
                self.store.add_interval(entry["start"], end, entry["source"])
                committed += end - entry["start"]
            if entry["end"] > moment:
                entry["start"] = moment
                break
            self._pending.pop(0)
        return committed

    def pending(self) -> list[dict]:
        """Return a detached list of {start, end, source} pending intervals."""
        return deepcopy(self._pending)

    def preview_intervals(self) -> list[dict]:
        return self.pending()

    def discard_pending(self) -> float:
        seconds = sum(item["end"] - item["start"] for item in self._pending)
        self._pending.clear()
        self.status["pending_seconds"] = 0.0
        return seconds

    def break_observation(self) -> float:
        """Fail closed when a sampling attempt cannot establish foreground.

        Clearing only pending time would still let the next observation extend
        the old source across this failed sample. Reset the observation anchor
        as well, so recovery starts a new observed interval.
        """
        seconds = self.discard_pending()
        self._previous = None
        self._last_input = None
        self.status = {
            "state": "blocked", "idle_seconds": 0.0,
            "pending_seconds": 0.0, "source": None,
            "rolled_back_seconds": seconds, "committed_seconds": 0.0,
            "sampling_gap": True,
        }
        return seconds

    def tick(self, now: float, idle_seconds: float, source: dict | None,
             blocked: bool = False) -> dict:
        now = _finite(now, "now")
        idle_seconds = _finite(idle_seconds, "idle_seconds")
        if idle_seconds < 0:
            raise ValueError("idle_seconds must not be negative")
        source = self._source(source)
        observed_input = now - idle_seconds
        rolled_back = committed = 0.0
        previous = self._previous
        sampling_gap = bool(previous and now - previous["now"] > self.max_gap)

        if sampling_gap:
            # A suspended process or wall-clock jump cannot establish what
            # happened while sampling stopped. Discard rather than validate
            # the unresolved tail with a possibly unrelated resumed input.
            rolled_back += self.discard_pending()
            self._last_input = observed_input

        if previous and now <= previous["now"]:
            # A wall-clock correction must not duplicate/backfill history.
            rolled_back = self.discard_pending()
            self._last_input = observed_input
            previous = None
            sampling_gap = True

        if self._last_input is None:
            self._last_input = observed_input

        new_input = observed_input > self._last_input + self.INPUT_EPSILON
        old_spell_expired = new_input and observed_input - self._last_input >= self.idle_limit
        if old_spell_expired:
            # Input may resume between polls after the deadline. Checking only
            # the *current* idle age would wrongly validate the old spell.
            rolled_back += self.discard_pending()

        if previous and not sampling_gap and not blocked and not previous["blocked"]:
            previous_source = previous["source"]
            if previous_source:
                interval_start = previous["now"]
                if old_spell_expired:
                    interval_start = max(interval_start, observed_input)
                elif previous["idle_seconds"] >= self.idle_limit:
                    # After idle, resume at the newly observed input, never at
                    # the last polling time while the user was still away.
                    interval_start = max(interval_start, observed_input) if new_input else now
                self._append(interval_start, now, previous_source)

        if new_input:
            if not old_spell_expired:
                committed = self._commit_through(observed_input)
            self._last_input = observed_input

        if idle_seconds >= self.idle_limit:
            rolled_back += self.discard_pending()

        self._previous = {
            "now": now, "idle_seconds": idle_seconds,
            "source": source, "blocked": bool(blocked),
        }
        state = "blocked" if blocked else (
            "idle" if idle_seconds >= self.idle_limit else ("active" if source else "untracked")
        )
        self.status = {
            "state": state, "idle_seconds": idle_seconds,
            "pending_seconds": sum(x["end"] - x["start"] for x in self._pending),
            "source": source, "rolled_back_seconds": rolled_back,
            "committed_seconds": committed, "sampling_gap": sampling_gap,
        }
        return dict(self.status)
