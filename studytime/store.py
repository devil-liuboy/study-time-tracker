"""Local SQLite records and Beijing-calendar reports (no browsing content)."""

from __future__ import annotations

import math
import sqlite3
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


BEIJING = timezone(timedelta(hours=8))


def _number(value: float, label: str) -> float:
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(f"{label}必须为有限数字")
    return value


def _text(value: str, label: str, limit: int = 256) -> str:
    value = str(value).strip()
    if not value or len(value) > limit or any(ord(ch) < 32 for ch in value):
        raise ValueError(f"{label}不能为空、过长或包含控制字符")
    return value


def day_bounds(day: str | date) -> tuple[float, float]:
    if isinstance(day, str):
        day = date.fromisoformat(day)
    start = datetime.combine(day, datetime.min.time(), BEIJING)
    return start.timestamp(), (start + timedelta(days=1)).timestamp()


def _chunks(start: float, end: float):
    while start < end:
        current_day = datetime.fromtimestamp(start, BEIJING).date()
        _, midnight = day_bounds(current_day)
        chunk_end = min(end, midnight)
        yield current_day.isoformat(), start, chunk_end
        start = chunk_end


def _source(source: dict) -> dict:
    kind = source.get("kind")
    if kind not in ("app", "website"):
        raise ValueError("来源类型必须是 app 或 website")
    return {
        "id": _text(source.get("id", ""), "来源标识"),
        "name": _text(source.get("name", ""), "来源名称"),
        "kind": kind,
        "category": _text(source.get("category", "学习"), "分类", 80),
    }


class Store:
    def __init__(self, path: str | Path):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._db = sqlite3.connect(str(path), check_same_thread=False, timeout=10)
        self._db.row_factory = sqlite3.Row
        with self._db:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute("PRAGMA busy_timeout=10000")
            self._db.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    start REAL NOT NULL, end REAL NOT NULL,
                    source_id TEXT NOT NULL, name TEXT NOT NULL,
                    kind TEXT NOT NULL, category TEXT NOT NULL,
                    seconds REAL NOT NULL, manual INTEGER NOT NULL DEFAULT 0
                )
            """)
            self._db.execute("CREATE INDEX IF NOT EXISTS sessions_time ON sessions(start,end)")

    def add_interval(self, start: float, end: float, source: dict) -> None:
        start, end = _number(start, "开始时间"), _number(end, "结束时间")
        if end < start or end - start > 86400 * 366:
            raise ValueError("时间范围无效")
        if end == start:
            return
        source = _source(source)
        chunks = list(_chunks(start, end))
        with self._lock, self._db:
            collision = self._db.execute(
                "SELECT 1 FROM sessions WHERE manual=0 AND start<? AND end>? LIMIT 1", (end, start)
            ).fetchone()
            if collision:
                raise ValueError("自动记录的时间区间不能重叠")
            for day, left, right in chunks:
                last = self._db.execute(
                    "SELECT * FROM sessions WHERE manual=0 ORDER BY end DESC LIMIT 1"
                ).fetchone()
                can_merge = (last and abs(last["end"] - left) < 1e-6
                    and datetime.fromtimestamp(last["start"], BEIJING).date().isoformat() == day
                    and all(last[column] == source[key] for column, key in (
                        ("source_id", "id"), ("name", "name"), ("kind", "kind"), ("category", "category"))))
                if can_merge:
                    self._db.execute(
                        "UPDATE sessions SET end=?, seconds=? WHERE id=?",
                        (right, right - last["start"], last["id"]),
                    )
                else:
                    self._db.execute("""
                        INSERT INTO sessions(start,end,source_id,name,kind,category,seconds,manual)
                        VALUES(?,?,?,?,?,?,?,0)
                    """, (left, right, source["id"], source["name"], source["kind"], source["category"], right-left))

    def _day_total(self, start: float, end: float) -> float:
        rows = self._db.execute("""
            SELECT start,end,seconds,manual FROM sessions
            WHERE (manual=0 AND start<? AND end>?) OR (manual=1 AND start>=? AND start<?)
        """, (end, start, start, end))
        return sum(row["seconds"] if row["manual"] else
                   min(end, row["end"]) - max(start, row["start"]) for row in rows)

    def add_manual(self, date: str, seconds: float, name: str = "手动修正",
                   category: str = "手动修正") -> int:
        """Add a signed daily adjustment, without changing automatic records.

        Negative entries stay visible. Resulting confirmed daily totals must
        remain within 0–24 hours; pending time cannot fund a deduction.
        """
        start, end = day_bounds(date)
        seconds = _number(seconds, "修正时长")
        if not seconds or abs(seconds) > 86400:
            raise ValueError("修正时长必须非零，且绝对值不超过 24 小时")
        name, category = _text(name, "名称"), _text(category, "分类", 80)
        with self._lock, self._db:
            result = self._day_total(start, end) + seconds
            if result < -1e-6 or result > 86400 + 1e-6:
                raise ValueError("修正后的当日已确认时长须在 0 到 24 小时之间")
            cursor = self._db.execute("""
                INSERT INTO sessions(start,end,source_id,name,kind,category,seconds,manual)
                VALUES(?,?,? ,?,'manual',?,?,1)
            """, (start, start, "manual:" + category + ":" + name, name, category, seconds))
            return int(cursor.lastrowid)

    def delete_manual(self, entry_id: int) -> None:
        with self._lock, self._db:
            row = self._db.execute("SELECT * FROM sessions WHERE id=?", (int(entry_id),)).fetchone()
            if not row or not row["manual"]:
                raise ValueError("只能撤销存在的手动修正记录")
            start, end = day_bounds(datetime.fromtimestamp(row["start"], BEIJING).date())
            result = self._day_total(start, end) - row["seconds"]
            if result < -1e-6 or result > 86400 + 1e-6:
                raise ValueError("撤销后当日时长超出范围，请先撤销依赖此记录的修正")
            self._db.execute("DELETE FROM sessions WHERE id=?", (int(entry_id),))

    def report(self, start: float, end: float, pending: list[dict] | None = None) -> dict:
        start, end = _number(start, "开始时间"), _number(end, "结束时间")
        if end <= start or end - start > 86400 * 366:
            raise ValueError("查询范围须大于零且不超过 366 天")
        daily = {day: 0.0 for day, _, _ in _chunks(start, end)}
        items: dict[tuple, dict] = {}
        sessions: list[dict] = []
        confirmed = provisional = 0.0

        def accumulate(left: float, right: float, source: dict, seconds: float,
                       entry_id: int | str, manual: bool, is_pending: bool):
            key = (source["id"], source["name"], source["kind"], source["category"])
            item = items.setdefault(key, {**source, "seconds": 0.0, "pending_seconds": 0.0})
            item["seconds"] += seconds
            if is_pending:
                item["pending_seconds"] += seconds
            if manual:
                day = datetime.fromtimestamp(left, BEIJING).date().isoformat()
                daily[day] = daily.get(day, 0.0) + seconds
            else:
                for day, chunk_start, chunk_end in _chunks(left, right):
                    daily[day] = daily.get(day, 0.0) + chunk_end-chunk_start
            sessions.append({
                "id": entry_id, "start": left, "end": right,
                "source_id": source["id"], "name": source["name"],
                "kind": source["kind"], "category": source["category"],
                "seconds": seconds, "manual": manual, "pending": is_pending,
                "date": datetime.fromtimestamp(left, BEIJING).date().isoformat(),
            })

        with self._lock:
            rows = self._db.execute("""
                SELECT * FROM sessions
                WHERE (manual=0 AND start<? AND end>?) OR (manual=1 AND start>=? AND start<?)
                ORDER BY start DESC,id DESC
            """, (end, start, start, end)).fetchall()
        for row in rows:
            manual = bool(row["manual"])
            left = row["start"] if manual else max(start, row["start"])
            right = row["end"] if manual else min(end, row["end"])
            seconds = row["seconds"] if manual else right-left
            confirmed += seconds
            accumulate(left, right, {"id": row["source_id"], "name": row["name"],
                       "kind": row["kind"], "category": row["category"]},
                       seconds, row["id"], manual, False)
        for index, entry in enumerate(pending or []):
            left, right = max(start, entry["start"]), min(end, entry["end"])
            if right <= left:
                continue
            source = _source(entry["source"])
            provisional += right-left
            accumulate(left, right, source, right-left, f"pending-{index}", False, True)
        return {
            "total_seconds": confirmed + provisional,
            "confirmed_seconds": confirmed, "pending_seconds": provisional,
            "items": sorted(items.values(), key=lambda item: item["seconds"], reverse=True),
            "daily": [{"date": day, "seconds": seconds} for day, seconds in sorted(daily.items())],
            "sessions": sorted(sessions, key=lambda entry: entry["start"], reverse=True),
        }

    def close(self) -> None:
        with self._lock:
            self._db.close()
