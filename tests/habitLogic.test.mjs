import test from "node:test";
import assert from "node:assert/strict";
import {
  addDaysISO,
  buildIfThen,
  buildSuggestions,
  calculateStats,
  getRecoveryCandidates,
  normalizeHabit,
  upsertLog,
  validateHabitInput,
} from "../src/habitLogic.mjs";

const baseHabit = normalizeHabit({
  id: "h1",
  name: "英語を1分読む",
  targetAction: "英語の記事を5分読む",
  tinyAction: "1文だけ読む",
  anchor: "朝食のあと",
  fallback: "最小版だけ実行して明日に戻る",
  days: [1, 2, 3, 4, 5],
  createdAt: "2026-05-18",
});

test("buildIfThen creates a concrete implementation intention", () => {
  assert.equal(
    buildIfThen(baseHabit),
    "もし朝食のあとなら、英語の記事を5分読む。難しい日は「1文だけ読む」だけでよい。",
  );
});

test("calculateStats counts full and tiny completion without treating today as missed", () => {
  const logs = [
    { habitId: "h1", date: "2026-05-18", status: "done" },
    { habitId: "h1", date: "2026-05-19", status: "tiny" },
    { habitId: "h1", date: "2026-05-20", status: "missed" },
  ];
  const stats = calculateStats([baseHabit], logs, {
    endIso: "2026-05-21",
    dayCount: 4,
    includeTodayAsEligible: false,
  });

  assert.equal(stats.totals.completed, 2);
  assert.equal(stats.totals.missed, 1);
  assert.equal(stats.totals.pending, 1);
  assert.equal(stats.eligible, 3);
  assert.equal(stats.consistencyPercent, 67);
});

test("upsertLog replaces the same habit and date", () => {
  const logs = upsertLog(
    [{ habitId: "h1", date: "2026-05-18", status: "missed" }],
    { habitId: "h1", date: "2026-05-18", status: "tiny" },
  );
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, "tiny");
});

test("getRecoveryCandidates returns yesterday's missed scheduled habit", () => {
  const logs = [{ habitId: "h1", date: "2026-05-21", status: "later" }];
  const candidates = getRecoveryCandidates([baseHabit], logs, "2026-05-22");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, "h1");
});

test("buildSuggestions recommends reducing difficulty when completion is low", () => {
  const logs = [
    { habitId: "h1", date: "2026-05-18", status: "missed" },
    { habitId: "h1", date: "2026-05-19", status: "missed" },
    { habitId: "h1", date: "2026-05-20", status: "tiny" },
  ];
  const suggestions = buildSuggestions([baseHabit], logs, "2026-05-22");
  assert.ok(suggestions.some((item) => item.includes("最小版")));
});

test("validateHabitInput catches missing required fields and weekday selection", () => {
  const errors = validateHabitInput({
    name: "",
    targetAction: "",
    tinyAction: "",
    anchor: "",
    fallback: "",
    days: [],
  });
  assert.equal(errors.length, 6);
});

test("addDaysISO handles month boundaries", () => {
  assert.equal(addDaysISO("2026-05-31", 1), "2026-06-01");
});
