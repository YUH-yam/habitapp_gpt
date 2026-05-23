import {
  MISSED_REASONS,
  REASON_LABELS,
  STATUS_LABELS,
  assessHabitDifficulty,
  buildCoachComment,
  buildIfThen,
  buildSuggestions,
  calculateRecoveryMetrics,
  calculateStats,
  getDueHabits,
  getHabitLifecycle,
  getLogForDate,
  getRecoveryCandidates,
  normalizeHabit,
  toISODate,
  upsertLog,
  validateHabitInput,
} from "./habitLogic.mjs";

const STORAGE_KEY = "habitapp-gpt-state-v1";
const BUILDER_STEP_MAX = 4;

const todayRoot = document.querySelector("#todayRoot");
const reviewRoot = document.querySelector("#reviewRoot");
const managedHabits = document.querySelector("#managedHabits");
const templateStrip = document.querySelector("#templateStrip");
const habitForm = document.querySelector("#habitForm");
const ifThenPreview = document.querySelector("#ifThenPreview");
const difficultyPreview = document.querySelector("#difficultyPreview");
const toast = document.querySelector("#toast");
const installButton = document.querySelector("#installButton");
const cancelEditButton = document.querySelector("#cancelEditButton");
const saveHabitButton = document.querySelector("#saveHabitButton");
const builderPrevButton = document.querySelector("#builderPrevButton");
const builderNextButton = document.querySelector("#builderNextButton");

const habitTemplates = [
  {
    name: "英語を1分読む",
    why: "英語に触れる抵抗感を減らす",
    category: "learning",
    targetAction: "英語の記事を5分読む",
    tinyAction: "英単語を1つ見る",
    anchor: "朝食のあと",
    fallback: "英単語1つだけ見て完了にする",
    reminderWindow: "朝",
    days: [1, 2, 3, 4, 5],
  },
  {
    name: "肩をほぐす",
    why: "仕事終わりの疲れを軽くする",
    category: "health",
    targetAction: "肩回しを2分する",
    tinyAction: "肩を3回まわす",
    anchor: "PCを閉じたら",
    fallback: "肩を3回まわして今日は完了にする",
    reminderWindow: "夕方",
    days: [1, 2, 3, 4, 5],
  },
  {
    name: "日記を1行書く",
    why: "考えを翌日に持ち越さない",
    category: "mind",
    targetAction: "今日のことを3行書く",
    tinyAction: "一言だけ書く",
    anchor: "寝る準備を始めたら",
    fallback: "一言だけ書いて画面を閉じる",
    reminderWindow: "夜",
    days: [0, 1, 2, 3, 4, 5, 6],
  },
  {
    name: "水を一口飲む",
    why: "午後のだるさを減らす",
    category: "health",
    targetAction: "コップ1杯の水を飲む",
    tinyAction: "水を一口飲む",
    anchor: "仕事を始める前",
    fallback: "水を一口だけ飲んで戻る",
    reminderWindow: "朝",
    days: [1, 2, 3, 4, 5],
  },
  {
    name: "机を1つ片付ける",
    why: "仕事に入りやすい環境を作る",
    category: "work",
    targetAction: "机の上を3分片付ける",
    tinyAction: "物を1つだけ戻す",
    anchor: "PCを開く前",
    fallback: "物を1つだけ戻して完了にする",
    reminderWindow: "朝",
    days: [1, 2, 3, 4, 5],
  },
  {
    name: "寝る前の画面を減らす",
    why: "睡眠の質を上げる",
    category: "mind",
    targetAction: "寝る15分前にスマホを机へ置く",
    tinyAction: "スマホを手から離す",
    anchor: "布団に入る前",
    fallback: "スマホを机に置くだけで完了にする",
    reminderWindow: "夜",
    days: [0, 1, 2, 3, 4, 5, 6],
  },
];

let state = loadState();
let selectedDays = new Set([1, 2, 3, 4, 5]);
let builderStep = 0;
let deferredInstallPrompt = null;

init();

function init() {
  applyPreferences();
  bindEvents();
  renderAll();
  registerServiceWorker();
}

function loadState() {
  const fallback = {
    version: 4,
    profile: { name: "", gentleTone: true },
    settings: { theme: "system", largeText: false },
    habits: [],
    logs: [],
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      ...fallback,
      ...parsed,
      profile: { ...fallback.profile, ...(parsed.profile || {}) },
      settings: { ...fallback.settings, ...(parsed.settings || {}) },
      habits: Array.isArray(parsed.habits) ? parsed.habits.map((habit) => normalizeHabit(habit)) : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
    };
  } catch {
    return fallback;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const navButton = event.target.closest("[data-view]");
    if (navButton) {
      switchView(navButton.dataset.view);
      return;
    }

    const builderStepButton = event.target.closest("[data-builder-step-target]");
    if (builderStepButton) {
      setBuilderStep(Number(builderStepButton.dataset.builderStepTarget));
      return;
    }

    const templateButton = event.target.closest("[data-template-index]");
    if (templateButton) {
      fillTemplate(Number(templateButton.dataset.templateIndex));
      return;
    }

    const logButton = event.target.closest("[data-log-status]");
    if (logButton) {
      recordHabit(logButton.dataset.habitId, logButton.dataset.logStatus);
      return;
    }

    const editButton = event.target.closest("[data-edit-habit]");
    if (editButton) {
      editHabit(editButton.dataset.editHabit);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-habit]");
    if (deleteButton) {
      deleteHabit(deleteButton.dataset.deleteHabit);
      return;
    }

    const pauseButton = event.target.closest("[data-toggle-pause]");
    if (pauseButton) {
      togglePause(pauseButton.dataset.togglePause);
      return;
    }

    const graduateButton = event.target.closest("[data-toggle-graduate]");
    if (graduateButton) {
      toggleGraduate(graduateButton.dataset.toggleGraduate);
    }
  });

  document.querySelector("#weekdayPicker").addEventListener("click", (event) => {
    const button = event.target.closest("[data-day]");
    if (!button) return;
    const day = Number(button.dataset.day);
    if (selectedDays.has(day)) selectedDays.delete(day);
    else selectedDays.add(day);
    updateWeekdayButtons();
    updatePreview();
  });

  builderPrevButton.addEventListener("click", () => setBuilderStep(builderStep - 1));
  builderNextButton.addEventListener("click", () => setBuilderStep(builderStep + 1));

  habitForm.addEventListener("input", updatePreview);
  habitForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveHabitFromForm();
  });

  cancelEditButton.addEventListener("click", resetForm);
  document.querySelector("#profileName").addEventListener("input", (event) => {
    state.profile.name = event.target.value.trim();
    persistAndRender();
  });
  document.querySelector("#themeSelect").addEventListener("change", (event) => {
    state.settings.theme = event.target.value;
    persistAndRender();
  });
  document.querySelector("#largeTextToggle").addEventListener("change", (event) => {
    state.settings.largeText = event.target.checked;
    persistAndRender();
  });
  document.querySelector("#gentleToneToggle").addEventListener("change", (event) => {
    state.profile.gentleTone = event.target.checked;
    persistAndRender();
  });
  document.querySelector("#requestNotificationButton").addEventListener("click", requestNotification);
  document.querySelector("#exportButton").addEventListener("click", exportData);
  document.querySelector("#exportCsvButton").addEventListener("click", exportCsv);
  document.querySelector("#exportMarkdownButton").addEventListener("click", exportWeeklyMarkdown);
  document.querySelector("#importInput").addEventListener("change", importData);
  document.querySelector("#resetButton").addEventListener("click", resetData);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installButton.hidden = true;
  });
}

function renderAll() {
  renderToday();
  renderDesign();
  renderReview();
  renderSettings();
  updateWeekdayButtons();
  updatePreview();
  setBuilderStep(builderStep);
}

function persistAndRender() {
  saveState();
  applyPreferences();
  renderAll();
}

function switchView(view) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("is-active", screen.id === `screen-${view}`);
  });
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
  window.scrollTo({ top: 0, behavior: "auto" });
}

function renderToday() {
  const today = toISODate();
  const dueHabits = getDueHabits(state.habits, today);
  const recovery = getRecoveryCandidates(state.habits, state.logs, today);
  const stats7 = calculateStats(state.habits, state.logs, {
    endIso: today,
    dayCount: 7,
    includeTodayAsEligible: false,
  });
  const stats30 = calculateStats(state.habits, state.logs, {
    endIso: today,
    dayCount: 30,
    includeTodayAsEligible: false,
  });
  const recoveryMetrics = calculateRecoveryMetrics(state.habits, state.logs, {
    endIso: today,
    dayCount: 30,
  });
  const completedToday = dueHabits.filter((habit) => {
    const log = getLogForDate(state.logs, habit.id, today);
    return log?.status === "done" || log?.status === "tiny";
  }).length;
  const primary = recovery[0] || dueHabits.find((habit) => {
    const log = getLogForDate(state.logs, habit.id, today);
    return !(log?.status === "done" || log?.status === "tiny");
  }) || dueHabits[0];

  todayRoot.innerHTML = `
    <section class="today-console">
      <div class="console-head">
        <div class="date-block">
          <span>${formatDisplayDate(today)}</span>
          <strong>${Math.max(0, dueHabits.length - completedToday)}</strong>
        </div>
        <span class="badge">${buildTodayBadge(dueHabits, completedToday)}</span>
      </div>
      <div class="signal-strip">
        <div class="signal"><span class="metric-label">今日</span><strong>${completedToday}/${dueHabits.length}</strong></div>
        <div class="signal"><span class="metric-label">7日</span><strong>${stats7.consistencyPercent}%</strong></div>
        <div class="signal"><span class="metric-label">復帰</span><strong>${recoveryMetrics.recovered}</strong></div>
      </div>
    </section>
    ${state.habits.length === 0 ? renderEmptyToday() : ""}
    ${state.habits.length > 0 && dueHabits.length === 0 ? renderOffDay() : ""}
    ${primary ? renderFocusBoard(primary) : ""}
    ${state.habits.length > 0 ? renderTodayList(dueHabits, primary?.id, stats30) : ""}
  `;
}

function buildTodayBadge(dueHabits, completedToday) {
  if (state.habits.length === 0) return "未登録";
  if (dueHabits.length === 0) return "予定なし";
  if (completedToday === dueHabits.length) return "完了";
  return "残りあり";
}

function renderEmptyToday() {
  return `
    <section class="starter-board">
      <div class="starter-copy">
        <p class="panel-kicker">Start small</p>
        <h2>まず1つ選ぶ</h2>
        <p class="muted-text">細かい調整はあとでできます。今日は、最小版まで決まっている候補から始めます。</p>
      </div>
      <div class="starter-grid">
        ${habitTemplates.slice(0, 4).map((template, index) => renderStarterButton(template, index)).join("")}
      </div>
    </section>
  `;
}

function renderStarterButton(template, index) {
  return `
    <button class="starter-card" type="button" data-template-index="${index}">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <strong>${escapeHtml(template.name)}</strong>
      <small>${escapeHtml(template.tinyAction)}</small>
    </button>
  `;
}

function renderOffDay() {
  return `
    <section class="starter-board">
      <div class="starter-copy">
        <p class="panel-kicker">No schedule</p>
        <h2>今日は予定なし</h2>
        <p class="muted-text">予定日ではありません。記録を増やしたい場合は、設計画面で曜日を調整できます。</p>
      </div>
    </section>
  `;
}

function renderFocusBoard(habit) {
  const today = toISODate();
  const log = getLogForDate(state.logs, habit.id, today);
  const status = log?.status || "pending";
  const difficulty = assessHabitDifficulty(habit);
  const lifecycle = getHabitLifecycle(habit, state.logs, today);
  const reasonOptions = MISSED_REASONS.map((reason) => `
    <option value="${reason.value}" ${log?.reason === reason.value ? "selected" : ""}>${reason.label}</option>
  `).join("");

  return `
    <section class="ritual-board">
      <div class="ritual-rail" aria-hidden="true">
        <span class="rail-dot"></span>
        <span class="rail-line"></span>
        <span class="rail-label">now</span>
      </div>
      <div class="ritual-main">
        <div class="ritual-heading">
          <div>
            <p class="panel-kicker">${escapeHtml(habit.reminderWindow)} / ${escapeHtml(lifecycle)} / 難易度${difficulty.label}</p>
            <h2>${escapeHtml(habit.name)}</h2>
          </div>
          <span class="status-pill ${status}">${STATUS_LABELS[status]}</span>
        </div>

        <div class="command-panel">
          <span>最小版</span>
          <strong>${escapeHtml(habit.tinyAction)}</strong>
        </div>

        <p class="plan-note">${escapeHtml(buildIfThen(habit))}</p>
        ${log?.reason ? `<p class="reason-note">未実行理由: ${escapeHtml(REASON_LABELS[log.reason] || log.reason)}</p>` : ""}
        ${(status === "missed" || status === "later") ? `<p class="recovery-note">戻り方: ${escapeHtml(habit.fallback)}</p>` : ""}

        <label class="reason-control">
          見送る理由
          <select data-reason-select="${habit.id}">
            <option value="">選択なし</option>
            ${reasonOptions}
          </select>
        </label>

        <div class="action-matrix">
          <button class="primary-button" type="button" data-habit-id="${habit.id}" data-log-status="tiny">最小版で完了</button>
          <button class="secondary-button" type="button" data-habit-id="${habit.id}" data-log-status="done">通常完了</button>
          <button class="ghost-button" type="button" data-habit-id="${habit.id}" data-log-status="later">明日に回す</button>
          <button class="ghost-button" type="button" data-habit-id="${habit.id}" data-log-status="missed">今日は無理</button>
        </div>
      </div>
    </section>
  `;
}

function renderTodayList(dueHabits, primaryId, stats30) {
  const others = dueHabits.filter((habit) => habit.id !== primaryId);
  if (others.length === 0) {
    return `<p class="muted-text">30日実行率: ${stats30.consistencyPercent}%</p>`;
  }

  return `
    <div class="quiet-list">
      ${others.map((habit) => {
        const log = getLogForDate(state.logs, habit.id, toISODate());
        return `
          <div class="list-row">
            <div>
              <div class="habit-name">${escapeHtml(habit.name)}</div>
              <p class="habit-meta">${escapeHtml(habit.tinyAction)}</p>
            </div>
            <span class="status-pill ${log?.status || "pending"}">${STATUS_LABELS[log?.status || "pending"]}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderDesign() {
  templateStrip.innerHTML = habitTemplates.map((template, index) => `
    <button class="template-button" type="button" data-template-index="${index}">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <strong>${escapeHtml(template.name)}</strong>
    </button>
  `).join("");

  managedHabits.innerHTML = state.habits.length === 0
    ? ""
    : state.habits.map((habit) => {
      const difficulty = assessHabitDifficulty(habit);
      const lifecycle = getHabitLifecycle(habit, state.logs, toISODate());
      return `
        <article class="saved-row">
          <div class="saved-summary">
            <div>
              <div class="habit-name">${escapeHtml(habit.name)}</div>
              <p class="habit-meta">${escapeHtml(habit.anchor)} / ${escapeHtml(lifecycle)} / 難易度${difficulty.label}</p>
            </div>
            <span class="badge">${habit.days.length}日</span>
          </div>
          <div class="manage-actions">
            <button class="secondary-button" type="button" data-edit-habit="${habit.id}">編集</button>
            <button class="ghost-button" type="button" data-toggle-pause="${habit.id}">${habit.paused ? "再開" : "一時停止"}</button>
            <button class="ghost-button" type="button" data-toggle-graduate="${habit.id}">${habit.graduated ? "戻す" : "卒業"}</button>
            <button class="danger-button" type="button" data-delete-habit="${habit.id}">削除</button>
          </div>
        </article>
      `;
    }).join("");
}

function renderReview() {
  const today = toISODate();
  const stats7 = calculateStats(state.habits, state.logs, {
    endIso: today,
    dayCount: 7,
    includeTodayAsEligible: false,
  });
  const stats30 = calculateStats(state.habits, state.logs, {
    endIso: today,
    dayCount: 30,
    includeTodayAsEligible: false,
  });
  const recoveryMetrics = calculateRecoveryMetrics(state.habits, state.logs, {
    endIso: today,
    dayCount: 30,
  });
  const suggestions = buildSuggestions(state.habits, state.logs, today);
  const coachComment = buildCoachComment(state.habits, state.logs, today);

  reviewRoot.innerHTML = `
    <div class="review-stack">
      <section class="review-panel">
        <p class="panel-kicker">Current read</p>
        <p class="review-lede">${escapeHtml(coachComment)}</p>
        <div class="review-signals">
          <div class="review-signal"><span class="metric-label">7日</span><strong>${stats7.consistencyPercent}%</strong></div>
          <div class="review-signal"><span class="metric-label">30日</span><strong>${stats30.consistencyPercent}%</strong></div>
          <div class="review-signal"><span class="metric-label">最小版</span><strong>${stats30.totals.tiny}</strong></div>
        </div>
        ${stats7.byDay.map((day) => {
          const rate = day.scheduled > 0 ? Math.round((day.completed / day.scheduled) * 100) : 0;
          return `
            <div class="bar-row">
              <span>${day.day}</span>
              <div class="bar-track" aria-label="${day.day}曜日 ${rate}%"><div class="bar-fill" style="width:${rate}%"></div></div>
              <span>${rate}%</span>
            </div>
          `;
        }).join("")}
      </section>

      <section class="review-panel">
        <p class="panel-kicker">Friction</p>
        ${recoveryMetrics.topReasons.length > 0 ? `
          <ul class="list">
            ${recoveryMetrics.topReasons.slice(0, 4).map((reason) => `
              <li>${escapeHtml(reason.label)}: ${reason.count}回</li>
            `).join("")}
          </ul>
        ` : "<p class=\"muted-text\">まだ記録はありません。</p>"}
      </section>

      <section class="review-panel">
        <p class="panel-kicker">Habit state</p>
        <div>
          ${state.habits.length > 0 ? state.habits.map(renderHabitScore).join("") : "<p class=\"muted-text\">習慣を保存すると表示されます。</p>"}
        </div>
      </section>

      <section class="review-panel">
        <p class="panel-kicker">Next tune</p>
        <ul class="list">
          ${suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </section>
    </div>
  `;
}

function renderHabitScore(habit) {
  const today = toISODate();
  const habitStats = calculateStats([habit], state.logs, {
    endIso: today,
    dayCount: 30,
    includeTodayAsEligible: false,
  });
  const difficulty = assessHabitDifficulty(habit);
  const lifecycle = getHabitLifecycle(habit, state.logs, today);
  return `
    <div class="score-row">
      <strong>${escapeHtml(habit.name)}</strong>
      <span>${escapeHtml(lifecycle)} / 実行率${habitStats.consistencyPercent}% / 難易度${difficulty.label}</span>
    </div>
  `;
}

function renderSettings() {
  document.querySelector("#profileName").value = state.profile.name || "";
  document.querySelector("#themeSelect").value = state.settings.theme || "system";
  document.querySelector("#largeTextToggle").checked = Boolean(state.settings.largeText);
  document.querySelector("#gentleToneToggle").checked = state.profile.gentleTone !== false;
}

function saveHabitFromForm() {
  const formData = new FormData(habitForm);
  const id = formData.get("habitId") || "";
  const current = id ? state.habits.find((habit) => habit.id === id) : null;
  const input = {
    id: id || `habit-${globalThis.crypto?.randomUUID?.() || Date.now()}`,
    name: formData.get("name"),
    why: formData.get("why"),
    category: formData.get("category"),
    targetAction: formData.get("targetAction"),
    tinyAction: formData.get("tinyAction"),
    anchor: formData.get("anchor"),
    fallback: formData.get("fallback"),
    reminderWindow: formData.get("reminderWindow"),
    days: [...selectedDays],
    createdAt: current?.createdAt || toISODate(),
    paused: Boolean(current?.paused),
    graduated: Boolean(current?.graduated),
  };

  const errors = validateHabitInput(input);
  if (errors.length > 0) {
    showToast(errors[0]);
    setBuilderStep(getFirstInvalidStep(input));
    return;
  }

  const habit = normalizeHabit(input);
  state.habits = id
    ? state.habits.map((item) => (item.id === id ? habit : item))
    : [...state.habits, habit];
  saveState();
  resetForm();
  renderAll();
  switchView("today");
  showToast(id ? "更新しました。" : "保存しました。");
}

function fillTemplate(index) {
  const template = habitTemplates[index];
  if (!template) return;
  habitForm.reset();
  document.querySelector("#habitId").value = "";
  document.querySelector("#habitName").value = template.name;
  document.querySelector("#habitWhy").value = template.why;
  document.querySelector("#habitCategory").value = template.category;
  document.querySelector("#habitTarget").value = template.targetAction;
  document.querySelector("#habitTiny").value = template.tinyAction;
  document.querySelector("#habitAnchor").value = template.anchor;
  document.querySelector("#habitFallback").value = template.fallback;
  document.querySelector("#habitReminder").value = template.reminderWindow;
  selectedDays = new Set(template.days);
  saveHabitButton.textContent = "保存";
  cancelEditButton.hidden = true;
  updateWeekdayButtons();
  updatePreview();
  setBuilderStep(0);
  switchView("design");
  scrollBuilderIntoView();
}

function editHabit(id) {
  const habit = state.habits.find((item) => item.id === id);
  if (!habit) return;
  document.querySelector("#habitId").value = habit.id;
  document.querySelector("#habitName").value = habit.name;
  document.querySelector("#habitWhy").value = habit.why;
  document.querySelector("#habitCategory").value = habit.category;
  document.querySelector("#habitTarget").value = habit.targetAction;
  document.querySelector("#habitTiny").value = habit.tinyAction;
  document.querySelector("#habitAnchor").value = habit.anchor;
  document.querySelector("#habitFallback").value = habit.fallback;
  document.querySelector("#habitReminder").value = habit.reminderWindow;
  selectedDays = new Set(habit.days);
  saveHabitButton.textContent = "更新";
  cancelEditButton.hidden = false;
  updateWeekdayButtons();
  updatePreview();
  setBuilderStep(0);
  switchView("design");
  scrollBuilderIntoView();
}

function deleteHabit(id) {
  const habit = state.habits.find((item) => item.id === id);
  if (!habit) return;
  if (!window.confirm(`「${habit.name}」を削除します。記録も削除されます。`)) return;
  state.habits = state.habits.filter((item) => item.id !== id);
  state.logs = state.logs.filter((log) => log.habitId !== id);
  persistAndRender();
  showToast("削除しました。");
}

function togglePause(id) {
  const habit = state.habits.find((item) => item.id === id);
  if (!habit) return;
  state.habits = state.habits.map((item) => (
    item.id === id ? { ...item, paused: !item.paused, graduated: false } : item
  ));
  persistAndRender();
  showToast(habit.paused ? "再開しました。" : "一時停止しました。");
}

function toggleGraduate(id) {
  const habit = state.habits.find((item) => item.id === id);
  if (!habit) return;
  state.habits = state.habits.map((item) => (
    item.id === id ? { ...item, graduated: !item.graduated, paused: false } : item
  ));
  persistAndRender();
  showToast(habit.graduated ? "チェック対象に戻しました。" : "卒業にしました。");
}

function resetForm() {
  habitForm.reset();
  document.querySelector("#habitId").value = "";
  selectedDays = new Set([1, 2, 3, 4, 5]);
  saveHabitButton.textContent = "保存";
  cancelEditButton.hidden = true;
  setBuilderStep(0);
  updateWeekdayButtons();
  updatePreview();
}

function scrollBuilderIntoView() {
  requestAnimationFrame(() => {
    habitForm.scrollIntoView({ block: "start", behavior: "auto" });
  });
}

function getFirstInvalidStep(input) {
  if (!input.name?.trim()) return 0;
  if (!input.targetAction?.trim()) return 1;
  if (!input.tinyAction?.trim()) return 2;
  if (!input.anchor?.trim()) return 3;
  return 4;
}

function setBuilderStep(step) {
  builderStep = Math.max(0, Math.min(BUILDER_STEP_MAX, Number.isFinite(step) ? step : 0));
  document.querySelectorAll("[data-builder-step]").forEach((panel) => {
    panel.classList.toggle("is-active", Number(panel.dataset.builderStep) === builderStep);
  });
  document.querySelectorAll("[data-builder-step-target]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.builderStepTarget) === builderStep);
  });
  builderPrevButton.disabled = builderStep === 0;
  builderNextButton.disabled = builderStep === BUILDER_STEP_MAX;
}

function recordHabit(habitId, status) {
  const habit = state.habits.find((item) => item.id === habitId);
  if (!habit) return;
  const today = toISODate();
  const reason = status === "missed" || status === "later" ? getSelectedReason(habitId) : "";
  const log = {
    id: `log-${habitId}-${today}`,
    habitId,
    date: today,
    status,
    reason,
    note: "",
    createdAt: new Date().toISOString(),
  };
  state.logs = upsertLog(state.logs, log);
  persistAndRender();
  showToast(buildStatusMessage(habit, status));
}

function getSelectedReason(habitId) {
  const select = [...document.querySelectorAll("[data-reason-select]")]
    .find((item) => item.dataset.reasonSelect === habitId);
  return select?.value || "";
}

function buildStatusMessage(habit, status) {
  if (status === "done") return state.profile.gentleTone === false ? "完了しました。" : "通常版で記録しました。";
  if (status === "tiny") return `「${habit.tinyAction}」で記録しました。`;
  if (status === "later") return "明日に回しました。";
  return `今日は無理として記録しました。次は「${habit.fallback}」。`;
}

function updatePreview() {
  const formData = new FormData(habitForm);
  const previewHabit = normalizeHabit({
    name: formData.get("name"),
    fallback: formData.get("fallback"),
    reminderWindow: formData.get("reminderWindow"),
    targetAction: formData.get("targetAction"),
    tinyAction: formData.get("tinyAction"),
    anchor: formData.get("anchor"),
    days: [...selectedDays],
  });
  const difficulty = assessHabitDifficulty(previewHabit);
  ifThenPreview.textContent = buildIfThen(previewHabit);
  difficultyPreview.innerHTML = `
    <div class="diagnosis-mini">
      <span>難易度 ${difficulty.label}</span>
      <span>自動化 ${difficulty.automationScore}%</span>
    </div>
  `;
  updateDesignEditingMode();
}

function updateWeekdayButtons() {
  document.querySelectorAll(".weekday-chip").forEach((button) => {
    button.classList.toggle("is-selected", selectedDays.has(Number(button.dataset.day)));
  });
}

function updateDesignEditingMode() {
  const hasDraft = Boolean(
    document.querySelector("#habitId").value
      || document.querySelector("#habitName").value.trim()
      || document.querySelector("#habitTarget").value.trim()
      || document.querySelector("#habitTiny").value.trim(),
  );
  document.querySelector("#screen-design").classList.toggle("is-editing", hasDraft);
}

function applyPreferences() {
  const theme = state.settings.theme || "system";
  const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const resolvedTheme = theme === "dark" || (theme === "system" && systemDark) ? "dark" : "light";
  document.documentElement.dataset.theme = resolvedTheme;
  document.body.classList.toggle("large-text", Boolean(state.settings.largeText));
}

async function requestNotification() {
  if (!("Notification" in window)) {
    showToast("このブラウザでは通知を確認できません。");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    new Notification("余白習慣", { body: "通知はアプリ起動中の確認に使えます。" });
    showToast("通知を確認しました。");
  } else {
    showToast("通知は許可されませんでした。");
  }
}

function exportData() {
  downloadText(`habit-backup-${toISODate()}.json`, JSON.stringify(state, null, 2), "application/json");
}

function exportCsv() {
  const header = ["date", "habit", "status", "reason", "note"].join(",");
  const rows = state.logs.map((log) => {
    const habit = state.habits.find((item) => item.id === log.habitId);
    return [
      log.date,
      habit?.name || log.habitId,
      STATUS_LABELS[log.status] || log.status,
      REASON_LABELS[log.reason] || log.reason || "",
      log.note || "",
    ].map(csvCell).join(",");
  });
  downloadText(`habit-log-${toISODate()}.csv`, [header, ...rows].join("\n"), "text/csv;charset=utf-8");
}

function exportWeeklyMarkdown() {
  const today = toISODate();
  const stats7 = calculateStats(state.habits, state.logs, {
    endIso: today,
    dayCount: 7,
    includeTodayAsEligible: false,
  });
  const stats30 = calculateStats(state.habits, state.logs, {
    endIso: today,
    dayCount: 30,
    includeTodayAsEligible: false,
  });
  const recoveryMetrics = calculateRecoveryMetrics(state.habits, state.logs, {
    endIso: today,
    dayCount: 30,
  });
  const suggestions = buildSuggestions(state.habits, state.logs, today);
  const lines = [
    `# 週次レビュー ${today}`,
    "",
    `- 7日間実行率: ${stats7.consistencyPercent}%`,
    `- 30日間実行率: ${stats30.consistencyPercent}%`,
    `- 最小版でつないだ回数: ${stats7.totals.tiny}`,
    `- 中断後に戻れた回数: ${recoveryMetrics.recovered}`,
    "",
    "## 未実行理由",
    ...(recoveryMetrics.topReasons.length > 0
      ? recoveryMetrics.topReasons.map((reason) => `- ${reason.label}: ${reason.count}回`)
      : ["- 記録なし"]),
    "",
    "## 次の調整",
    ...suggestions.map((item) => `- ${item}`),
  ];
  downloadText(`weekly-review-${today}.md`, lines.join("\n"), "text/markdown;charset=utf-8");
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

async function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    state = {
      ...loadState(),
      ...parsed,
      habits: Array.isArray(parsed.habits) ? parsed.habits.map((habit) => normalizeHabit(habit)) : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
    };
    persistAndRender();
    showToast("読み込みました。");
  } catch {
    showToast("読み込みに失敗しました。");
  } finally {
    event.target.value = "";
  }
}

function resetData() {
  if (!window.confirm("ローカルに保存された習慣と記録をすべて削除します。")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = loadState();
  resetForm();
  renderAll();
  switchView("today");
  showToast("削除しました。");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2400);
}

function formatDisplayDate(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {
    // Service worker registration should not block the core local-first app.
  });
}
