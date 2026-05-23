export const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export const STATUS_LABELS = {
  done: "完了",
  tiny: "最小版",
  later: "明日",
  missed: "今日は無理",
  pending: "未記録",
};

export const MISSED_REASONS = [
  { value: "forgot", label: "忘れていた" },
  { value: "time", label: "時間がなかった" },
  { value: "tired", label: "疲れていた" },
  { value: "mood", label: "気分が乗らなかった" },
  { value: "environment", label: "場所・環境が合わなかった" },
  { value: "too_heavy", label: "目標が重すぎた" },
  { value: "low_value", label: "必要性を感じなかった" },
];

export const REASON_LABELS = Object.fromEntries(
  MISSED_REASONS.map((reason) => [reason.value, reason.label]),
);

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
    graduated: Boolean(raw.graduated),
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
  if (!habit || habit.paused || habit.graduated) return false;
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

export function calculateRecoveryMetrics(habits, logs, options = {}) {
  const endIso = options.endIso || toISODate();
  const dayCount = options.dayCount || 30;
  const dates = getRangeDates(endIso, dayCount);
  let interruptions = 0;
  let recovered = 0;
  let recoveryDaysTotal = 0;
  const reasonCounts = {};

  for (const log of logs) {
    if (log.reason) {
      reasonCounts[log.reason] = (reasonCounts[log.reason] || 0) + 1;
    }
  }

  for (const habit of habits) {
    for (const date of dates) {
      if (!isHabitScheduled(habit, date)) continue;
      const log = getLogForDate(logs, habit.id, date);
      const interrupted = log?.status === "missed" || log?.status === "later";
      if (!interrupted) continue;

      interruptions += 1;
      for (let offset = 1; offset <= 2; offset += 1) {
        const nextDate = addDaysISO(date, offset);
        const nextLog = getLogForDate(logs, habit.id, nextDate);
        if (nextLog?.status === "done" || nextLog?.status === "tiny") {
          recovered += 1;
          recoveryDaysTotal += offset;
          break;
        }
      }
    }
  }

  const topReasons = Object.entries(reasonCounts)
    .map(([value, count]) => ({ value, label: REASON_LABELS[value] || value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    interruptions,
    recovered,
    recoveryRate: interruptions > 0 ? recovered / interruptions : 0,
    recoveryPercent: clampPercent(interruptions > 0 ? (recovered / interruptions) * 100 : 0),
    averageRecoveryDays: recovered > 0 ? Number((recoveryDaysTotal / recovered).toFixed(1)) : null,
    topReasons,
  };
}

export function assessHabitDifficulty(habit) {
  const reasons = [];
  const improvements = [];
  let score = 0;

  const targetMinutes = estimateMinutes(habit.targetAction);
  const tinyMinutes = estimateMinutes(habit.tinyAction);

  if (targetMinutes >= 15) {
    score += 3;
    reasons.push("通常版が長めです。");
    improvements.push("通常版を10分以内に下げる。");
  } else if (targetMinutes >= 6) {
    score += 1;
    reasons.push("通常版は少し重めです。");
    improvements.push("最初の2週間は通常版を半分にする。");
  }

  if (!habit.anchor || isVagueText(habit.anchor)) {
    score += 2;
    reasons.push("開始条件が曖昧です。");
    improvements.push("既存ルーティンを「朝食のあと」のように具体化する。");
  } else {
    reasons.push("既存ルーティンとの接続は良好です。");
  }

  if (!habit.tinyAction || tinyMinutes >= 3 || habit.tinyAction.length > 24) {
    score += 2;
    reasons.push("最小版がまだ少し重い可能性があります。");
    improvements.push("最小版を10〜30秒で終わる行動にする。");
  } else {
    reasons.push("最小版は小さく設定されています。");
  }

  if (!habit.fallback || isVagueText(habit.fallback)) {
    score += 1;
    reasons.push("できない日の代替が弱いです。");
    improvements.push("未実行時の戻り方を1文で決める。");
  }

  if (habit.days.length >= 7) {
    score += 2;
    reasons.push("毎日設定は負荷が高くなりやすいです。");
    improvements.push("開始2週間は週3〜5日にする。");
  } else if (habit.days.length >= 5) {
    score += 1;
    reasons.push("曜日数はやや多めです。");
  }

  if (habit.reminderWindow === "なし") {
    score += 1;
    reasons.push("通知窓が未設定です。");
    improvements.push("最初だけ通知窓を設定する。");
  }

  const level = score >= 6 ? "high" : score >= 3 ? "medium" : "low";
  const label = level === "high" ? "高め" : level === "medium" ? "中くらい" : "低め";
  const loadScore = clampPercent(100 - score * 12);
  const automationScore = clampPercent((habit.anchor && !isVagueText(habit.anchor) ? 45 : 15)
    + (habit.tinyAction && tinyMinutes < 3 ? 30 : 5)
    + (habit.fallback && !isVagueText(habit.fallback) ? 15 : 0)
    + Math.max(0, 10 - Math.abs(habit.days.length - 5) * 2));

  return {
    score,
    level,
    label,
    loadScore,
    automationScore,
    reasons,
    improvements: improvements.length > 0 ? improvements : ["この設計のまま1週間試して、記録から調整する。"],
  };
}

export function getHabitLifecycle(habit, logs, todayIso = toISODate()) {
  if (habit.graduated) return "卒業";
  if (habit.paused) return "一時停止";

  const stats30 = calculateStats([habit], logs, {
    endIso: todayIso,
    dayCount: 30,
    includeTodayAsEligible: false,
  });
  const stats14 = calculateStats([habit], logs, {
    endIso: todayIso,
    dayCount: 14,
    includeTodayAsEligible: false,
  });

  if (stats30.eligible === 0) return "設計中";
  if (stats30.eligible < 4) return "開始直後";
  if (stats14.eligible >= 5 && stats14.consistency < 0.4) return "停滞";
  if (stats30.eligible >= 20 && stats30.consistency >= 0.85) return "安定";
  if (stats30.eligible >= 12 && stats30.consistency >= 0.7) return "定着中";
  return "開始直後";
}

export function buildCoachComment(habits, logs, todayIso = toISODate()) {
  if (habits.length === 0) {
    return "まずは1つだけ設計してください。複数を同時に始めるより、最初の1つを軽く作るほうが安全です。";
  }

  const stats7 = calculateStats(habits, logs, {
    endIso: todayIso,
    dayCount: 7,
    includeTodayAsEligible: false,
  });
  const metrics = calculateRecoveryMetrics(habits, logs, { endIso: todayIso, dayCount: 30 });

  if (stats7.eligible >= 3 && stats7.consistency >= 0.8) {
    return "かなり安定しています。次の1週間も同じ設計で続けてください。";
  }

  if (stats7.eligible >= 3 && stats7.consistency >= 0.4) {
    return "継続の土台はできています。未実行の日の理由を見て、通知時間か最小版を調整しましょう。";
  }

  if (metrics.interruptions >= 3 && metrics.recovered === 0) {
    return "中断が続いています。今日は通常版を捨てて、最小版だけで復帰してください。";
  }

  return "今の習慣は少し重い可能性があります。通常版を半分にして、最小版を10秒で終わる行動にしましょう。";
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
  const metrics = calculateRecoveryMetrics(habits, logs, { endIso: todayIso, dayCount: 30 });
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

  const topReason = metrics.topReasons[0];
  if (topReason?.value === "tired") {
    suggestions.push("疲れが主な障害です。通知窓を前倒しし、通常版を軽くしてください。");
  } else if (topReason?.value === "forgot") {
    suggestions.push("忘れが主な障害です。既存ルーティンとの紐づけか通知窓を見直してください。");
  } else if (topReason?.value === "too_heavy") {
    suggestions.push("重さが主な障害です。最小版をさらに小さくするのが先です。");
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

function estimateMinutes(text = "") {
  const normalized = String(text);
  const hourMatch = normalized.match(/(\d+(?:\.\d+)?)\s*時間/);
  if (hourMatch) return Number(hourMatch[1]) * 60;
  const minuteMatch = normalized.match(/(\d+(?:\.\d+)?)\s*分/);
  if (minuteMatch) return Number(minuteMatch[1]);
  const secondMatch = normalized.match(/(\d+(?:\.\d+)?)\s*秒/);
  if (secondMatch) return Number(secondMatch[1]) / 60;
  return 1;
}

function isVagueText(text = "") {
  return /できるとき|時間がある|余裕|気が向いた|適当|どこか|いつか/.test(String(text));
}
