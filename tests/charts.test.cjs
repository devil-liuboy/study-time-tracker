"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const charts = require("../web/charts.js");

const epoch = value => Date.parse(value) / 1000;
const auto = (source, seconds, extra = {}) => ({
  source_id: source, name: source, category: "编程开发", kind: "app",
  seconds, manual: false, pending: false, ...extra,
});
const manual = (seconds, extra = {}) => ({
  source_id: "manual:correction", name: "手动修正", category: "手动修正",
  kind: "manual", seconds, manual: true, pending: false, ...extra,
});
const close = (actual, expected) => assert.ok(
  Math.abs(actual - expected) < 1e-8,
  `Expected ${actual} to be approximately ${expected}`,
);
const byDate = result => Object.fromEntries(result.days.map(day => [day.date, day]));

test("donut aggregates source sessions and keeps provisional time in its own total", () => {
  const result = charts.buildDistribution([
    auto("VS Code", 90), auto("VS Code", 30, { pending: true }),
    auto("arxiv.org", 60, { kind: "website", category: "文献阅读" }),
    manual(45), manual(-15),
  ]);
  assert.equal(result.total_seconds, 180);
  assert.equal(result.pending_seconds, 30);
  assert.equal(result.manual_seconds, 30);
  assert.equal(result.manual_count, 2);
  assert.deepEqual(result.items.map(item => [item.name, item.seconds]), [
    ["VS Code", 120], ["arxiv.org", 60],
  ]);
  close(result.items[0].percent, 200 / 3);
  close(result.items[1].percent, 100 / 3);
  close(result.items.reduce((sum, item) => sum + item.percent, 0), 100);
});

test("every signed manual row is excluded from geometry even when corrections cancel", () => {
  const result = charts.buildDistribution([
    auto("VS Code", 100), manual(60), manual(-60),
    auto("unusual manual flag", 500, { manual: true }),
    auto("unusual manual kind", -500, { kind: "manual" }),
  ]);
  assert.equal(result.total_seconds, 100);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].percent, 100);
  assert.equal(result.manual_seconds, 0);
  assert.equal(result.manual_count, 4);
});

test("top five plus Other preserves every second and the complete percentage", () => {
  const result = charts.buildDistribution([70, 60, 50, 40, 30, 20, 10].map(
    (seconds, index) => auto(`source-${index}`, seconds),
  ), { groupBy: "source", limit: 5 });
  assert.equal(result.items.length, 6);
  assert.equal(result.items.at(-1).id, "other");
  assert.equal(result.items.at(-1).seconds, 30);
  assert.equal(result.total_seconds, 280);
  assert.equal(result.items.reduce((sum, item) => sum + item.seconds, 0), 280);
  close(result.items.reduce((sum, item) => sum + item.percent, 0), 100);
  assert.ok(result.items.every(item => item.seconds > 0 && item.percent > 0));
});

test("source identity separates identical display names while category view combines them", () => {
  const rows = [
    auto("app:first", 40, { name: "Editor", category: "编程开发" }),
    auto("app:second", 60, { name: "Editor", category: "编程开发" }),
    auto("arxiv.org", 50, { kind: "website", category: "文献阅读" }),
  ];
  const sources = charts.buildDistribution(rows, { groupBy: "source" });
  assert.equal(sources.items.length, 3);
  const categories = charts.buildDistribution(rows, { groupBy: "category" });
  assert.deepEqual(categories.items.map(item => [item.name, item.seconds]), [
    ["编程开发", 100], ["文献阅读", 50],
  ]);
  assert.equal(categories.total_seconds, sources.total_seconds);
});

test("legacy English category aliases merge with their Chinese display category", () => {
  const result = charts.buildDistribution([
    auto("a", 30, { category: "coding" }),
    auto("b", 40, { category: "development" }),
    auto("c", 50, { category: "编程开发" }),
    auto("d", 60, { category: "ai" }),
    auto("e", 20, { category: "AI 助手" }),
  ], { groupBy: "category" });
  assert.deepEqual(result.items.map(item => [item.name, item.seconds]), [
    ["编程开发", 120], ["AI 助手", 80],
  ]);
});

test("empty and nonfinite/negative automatic inputs cannot generate invalid donut geometry", () => {
  for (const rows of [[], [auto("zero", 0), auto("negative", -1), auto("nan", NaN), auto("infinite", Infinity)]]) {
    const result = charts.buildDistribution(rows);
    assert.equal(result.total_seconds, 0);
    assert.equal(result.pending_seconds, 0);
    assert.deepEqual(result.items, []);
    assert.ok(!JSON.stringify(result).includes("null"), "empty numeric output must stay finite");
  }
});

test("week is Monday through Sunday and future dates are unobserved, not zero days", () => {
  const result = charts.buildCalendar([
    { date: "2026-11-02", seconds: 120 },
    { date: "2026-11-04", seconds: 60 },
    { date: "2026-11-05", seconds: 9999 },
  ], [], { range: "week", today: "2026-11-04" });
  assert.deepEqual(result.days.map(day => day.date), [
    "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05",
    "2026-11-06", "2026-11-07", "2026-11-08",
  ]);
  assert.equal(result.elapsed_days, 3);
  assert.equal(result.active_days, 2);
  assert.equal(result.total_seconds, 180);
  assert.equal(result.average_seconds, 60); // Tuesday's observed zero participates.
  assert.equal(result.max_seconds, 120);
  assert.deepEqual(result.best_day, { date: "2026-11-02", seconds: 120 });
  assert.equal(result.days[1].seconds, 0);
  assert.equal(result.days[2].is_today, true);
  for (const day of result.days.slice(3)) {
    assert.equal(day.seconds, null);
    assert.equal(day.pending_seconds, 0);
    assert.equal(day.is_future, true);
  }
});

test("calendar uses signed net daily totals, rather than adding automatic sessions again", () => {
  const result = charts.buildCalendar([
    { date: "2026-11-02", seconds: 480 },
    { date: "2026-11-03", seconds: 60 },
    { date: "2026-11-04", seconds: 0 },
  ], [
    auto("code", 600, { date: "2026-11-02" }), manual(-120, { date: "2026-11-02" }),
    manual(60, { date: "2026-11-03" }),
  ], { range: "week", today: "2026-11-04" });
  assert.equal(result.total_seconds, 540);
  assert.equal(result.average_seconds, 180);
  assert.equal(byDate(result)["2026-11-02"].seconds, 480);
  assert.equal(byDate(result)["2026-11-03"].seconds, 60);
});

test("a provisional session crossing Beijing midnight is split despite its start-date label", () => {
  const result = charts.buildCalendar([
    { date: "2026-11-03", seconds: 30 },
    { date: "2026-11-04", seconds: 90 },
  ], [auto("arxiv.org", 60, {
    kind: "website", pending: true, date: "2026-11-03",
    start: epoch("2026-11-03T15:59:30Z"), end: epoch("2026-11-03T16:00:30Z"),
  })], { range: "week", today: "2026-11-04" });
  const days = byDate(result);
  assert.equal(days["2026-11-03"].pending_seconds, 30);
  assert.equal(days["2026-11-04"].pending_seconds, 30);
  assert.equal(result.total_seconds, 120);
});

test("pending overlays cannot exceed net daily totals or extend into future days", () => {
  const result = charts.buildCalendar([
    { date: "2026-11-04", seconds: 10 },
  ], [auto("code", 30, {
    pending: true, start: epoch("2026-11-04T15:59:40Z"), end: epoch("2026-11-04T16:00:10Z"),
  })], { range: "week", today: "2026-11-04" });
  assert.equal(byDate(result)["2026-11-04"].pending_seconds, 10);
  assert.equal(byDate(result)["2026-11-05"].pending_seconds, 0);
  for (const day of result.days) {
    assert.ok(day.pending_seconds >= 0);
    assert.ok(day.pending_seconds <= Math.max(0, day.seconds || 0));
  }
});

test("negative defensive daily input remains explicit while positive geometry stays bounded", () => {
  const result = charts.buildCalendar([
    { date: "2026-11-02", seconds: -20 },
    { date: "2026-11-03", seconds: 50 },
  ], [], { range: "week", today: "2026-11-04" });
  assert.equal(byDate(result)["2026-11-02"].seconds, -20);
  assert.equal(result.total_seconds, 30);
  assert.equal(result.average_seconds, 10);
  assert.equal(result.max_seconds, 50);
  assert.equal(result.active_days, 1);
});

for (const [today, count] of [["2024-02-29", 29], ["2026-02-28", 28], ["2026-04-30", 30], ["2026-01-31", 31]]) {
  test(`month calendar has the real number of days for ${today}`, () => {
    const result = charts.buildCalendar([], [], { range: "month", today });
    assert.equal(result.days.length, count);
    assert.equal(result.days[0].date, today.slice(0, 8) + "01");
    assert.equal(result.days.at(-1).date, today);
    assert.equal(result.elapsed_days, count);
    assert.equal(result.average_seconds, 0);
    assert.equal(result.total_seconds, 0);
    assert.equal(result.max_seconds, 0);
    assert.equal(result.best_day, null);
    assert.equal(result.active_days, 0);
  });
}

test("month average includes elapsed empty dates but excludes all future dates", () => {
  const result = charts.buildCalendar([{ date: "2026-11-04", seconds: 120 }], [], {
    range: "month", today: "2026-11-04",
  });
  assert.equal(result.days.length, 30);
  assert.equal(result.elapsed_days, 4);
  assert.equal(result.average_seconds, 30);
  assert.equal(result.days.filter(day => day.is_future).length, 26);
});

test("Sunday weeks cross month boundaries using Beijing dates in every host timezone", () => {
  const modulePath = path.resolve(__dirname, "../web/charts.js");
  const program = `const charts=require(${JSON.stringify(modulePath)});process.stdout.write(JSON.stringify(charts.buildCalendar([],[],{range:'week',today:'2026-03-01'})));`;
  const observed = ["UTC", "America/Los_Angeles", "Asia/Tokyo"].map(tz => JSON.parse(
    execFileSync(process.execPath, ["-e", program], {
      env: { ...process.env, TZ: tz }, encoding: "utf8", windowsHide: true,
    }),
  ));
  for (const result of observed) {
    assert.equal(result.days[0].date, "2026-02-23");
    assert.equal(result.days.at(-1).date, "2026-03-01");
    assert.equal(result.elapsed_days, 7);
  }
  assert.deepEqual(observed[0], observed[1]);
  assert.deepEqual(observed[1], observed[2]);
});

test("default today switches at Beijing midnight instead of UTC midnight", () => {
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-11-03T15:59:59Z");
    const before = charts.buildCalendar([], [], { range: "week" });
    assert.equal(before.days.find(day => day.is_today).date, "2026-11-03");
    Date.now = () => Date.parse("2026-11-03T16:00:00Z");
    const after = charts.buildCalendar([], [], { range: "week" });
    assert.equal(after.days.find(day => day.is_today).date, "2026-11-04");
    assert.equal(after.elapsed_days, before.elapsed_days + 1);
  } finally {
    Date.now = originalNow;
  }
});

test("colors are deterministic and duration labels never expose NaN or Infinity", () => {
  const first = charts.colorFor("app:editor");
  assert.equal(typeof first, "string");
  assert.ok(first.length > 0);
  assert.equal(charts.colorFor("app:editor"), first);
  for (const seconds of [0, 59, 60, 3661, -120, NaN, Infinity, undefined]) {
    for (const compact of [false, true]) {
      const text = charts.formatDuration(seconds, { compact });
      assert.equal(typeof text, "string");
      assert.ok(!/NaN|Infinity|undefined/.test(text));
    }
  }
});
