export const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export const STATUS_LABELS = {
  done: "完了",
  tiny: "最小版",
  later: "後で",
  missed: "休む",
  pending: "未記録",
};

export function toISODate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseISODate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDaysISO(isoDate, offset) {
  const date = parseISODate(isoDate);
  date.setDate(date.getDate() + offset);
  return toISODate(date);
}

export function dayIndexFromISO(isoDate) {
  return parseISODate(isoDate).getDay();
}

export function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normalizeHabit(raw, today = toISODate()) {
  const days = Array.isArray(raw.days) && raw.days.length > 0
    ? raw.days.map(Number).filter((day) => day >= 0 && day <= 6)
    : [1, 2, 3, 4, 5];

  return {
    id: String(raw.id || `habit-${Date.now()}`),
    name: String(raw.name || "").trim(),
    why: String(raw.why || "").trim(),
    category: raw.category || "health",
    targetAction: String(raw.targetAction || raw.name || "").trim(),
    tinyAction: String(raw.tinyAction || "").trim(),
    anchor: String(raw.anchor || "").trim(),
    fallback: String(raw.fallback || "").trim(),
    reminderWindow: raw.reminderWindow || "朝",
    days: [...new Set(days)].sort((a, b) => a - b),
    createdAt: raw.createdAt || today,
    paused: Boolean(raw.paused),
  };
}

export function buildIfThen(habit) {
  const anchor = habit.anchor?.trim();
  const target = habit.targetAction?.trim() || habit.name?.trim();
  const tiny = habit.tinyAction?.trim();

  if (!anchor || !target) {
    return "既存ルーティンを選ぶと表示されます。";
  }

  const fallback = tiny ? `難しい日は「${tiny}」だけでよい。` : "";
  return `もし${anchor}なら、${target}。${fallback}`.trim();
}

export function isHabitScheduled(habit, isoDate) {
  if (!habit || habit.paused) return false;
  if (habit.createdAt && isoDate < habit.createdAt) return false;
  return habit.days.includes(dayIndexFromISO(isoDate));
}

export function getRangeDates(endIso, dayCount) {
  return Array.from({ length: dayCount }, (_, index) => addDaysISO(endIso, index - dayCount + 1));
}

export function getLogForDate(logs, habitId, isoDate) {
  return logs.find((log) => log.habitId === habitId && log.date === isoDate) || null;
}

export function upsertLog(logs, nextLog) {
  const filtered = logs.filter(
    (log) => !(log.habitId === nextLog.habitId && log.date === nextLog.date),
  );
  return [...filtered, nextLog].sort((a, b) => `${a.date}-${a.habitId}`.localeCompare(`${b.date}-${b.habitId}`));
}

export function getDueHabits(habits, isoDate) {
  return habits.filter((habit) => isHabitScheduled(habit, isoDate));
}

export function calculateStats(habits, logs, options = {}) {
  const endIso = options.endIso || toISODate();
  const dayCount = options.dayCount || 7;
  const includeTodayAsEligible = Boolean(options.includeTodayAsEligible);
  const dates = getRangeDates(endIso, dayCount);
  const byDay = dates.map((date) => ({
    date,
    day: DAY_LABELS[dayIndexFromISO(date)],
    scheduled: 0,
    completed: 0,
    done: 0,
    tiny: 0,
    later: 0,
    missed: 0,
    pending: 0,
  }));

  for (const bucket of byDay) {
    for (const habit of habits) {
      if (!isHabitScheduled(habit, bucket.date)) continue;

      bucket.scheduled += 1;
      const log = getLogForDate(logs, habit.id, bucket.date);
      if (log?.status === "done") {
        bucket.done += 1;
        bucket.completed += 1;
      } else if (log?.status === "tiny") {
        bucket.tiny += 1;
        bucket.completed += 1;
      } else if (log?.status === "later") {
        bucket.later += 1;
      } else if (log?.status === "missed") {
        bucket.missed += 1;
      } else if (bucket.date < endIso || includeTodayAsEligible) {
        bucket.missed += 1;
      } else {
        bucket.pending += 1;
      }
    }
  }

  const totals = byDay.reduce(
    (acc, day) => {
      acc.scheduled += day.scheduled;
      acc.completed += day.completed;
      acc.done += day.done;
      acc.tiny += day.tiny;
      acc.later += day.later;
      acc.missed += day.missed;
      acc.pending += day.pending;
      return acc;
    },
    { scheduled: 0, completed: 0, done: 0, tiny: 0, later: 0, missed: 0, pending: 0 },
  );

  const eligible = Math.max(0, totals.scheduled - totals.pending);
  const consistency = eligible > 0 ? totals.completed / eligible : 0;
  const restartRate = totals.missed + totals.later > 0
    ? totals.completed / (totals.completed + totals.missed + totals.later)
    : consistency;

  return {
    byDay,
    totals,
    eligible,
    consistency,
    consistencyPercent: clampPercent(consistency * 100),
    restartRate,
    restartPercent: clampPercent(restartRate * 100),
  };
}

export function getRecoveryCandidates(habits, logs, todayIso = toISODate()) {
  const yesterday = addDaysISO(todayIso, -1);
  return habits.filter((habit) => {
    if (!isHabitScheduled(habit, yesterday)) return false;
    if (getLogForDate(logs, habit.id, todayIso)) return false;
    const yesterdayLog = getLogForDate(logs, habit.id, yesterday);
    return !yesterdayLog || yesterdayLog.status === "missed" || yesterdayLog.status === "later";
  });
}

export function getBestDay(stats) {
  const completedDays = stats.byDay
    .filter((day) => day.scheduled > 0)
    .map((day) => ({
      day: day.day,
      rate: day.completed / day.scheduled,
      scheduled: day.scheduled,
    }))
    .sort((a, b) => b.rate - a.rate || b.scheduled - a.scheduled);

  return completedDays[0] || null;
}

export function buildSuggestions(habits, logs, todayIso = toISODate()) {
  if (habits.length === 0) {
    return ["最初の習慣は1つだけに絞るのが安全です。通常版より先に、最小版を決めてください。"];
  }

  const stats = calculateStats(habits, logs, {
    endIso: todayIso,
    dayCount: 7,
    includeTodayAsEligible: false,
  });
  const recovery = getRecoveryCandidates(habits, logs, todayIso);
  const bestDay = getBestDay(stats);
  const suggestions = [];

  if (recovery.length > 0) {
    suggestions.push(`昨日の空白は、今日の最小版で回収できます。対象は「${recovery[0].name}」です。`);
  }

  if (stats.eligible >= 3 && stats.consistency < 0.45) {
    suggestions.push("完了率が低めです。通常版ではなく、最小版を半分以下に下げるのが妥当です。");
  } else if (stats.eligible >= 3 && stats.consistency >= 0.75) {
    suggestions.push("実行は安定しています。通知を少し弱め、既存ルーティンだけで始める日を試せます。");
  } else {
    suggestions.push("今週は記録を増やす段階です。評価よりも、同じ文脈での反復を優先してください。");
  }

  if (bestDay && bestDay.rate > 0) {
    suggestions.push(`${bestDay.day}曜は実行しやすい傾向があります。次週も同じ前後の予定に寄せてください。`);
  }

  return suggestions;
}

export function validateHabitInput(input) {
  const errors = [];
  if (!input.name?.trim()) errors.push("習慣名が必要です。");
  if (!input.targetAction?.trim()) errors.push("通常版が必要です。");
  if (!input.tinyAction?.trim()) errors.push("最小版が必要です。");
  if (!input.anchor?.trim()) errors.push("既存ルーティンが必要です。");
  if (!input.fallback?.trim()) errors.push("できない日の代替が必要です。");
  if (!Array.isArray(input.days) || input.days.length === 0) errors.push("曜日を1つ以上選んでください。");
  return errors;
}
