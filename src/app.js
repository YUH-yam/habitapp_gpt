import {
  MISSED_REASONS,
  REASON_LABELS,
  STATUS_LABELS,
  assessHabitDifficulty,
  addDaysISO,
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
const todayRoot = document.querySelector("#todayRoot");
const insightsRoot = document.querySelector("#insightsRoot");
const managedHabits = document.querySelector("#managedHabits");
const templateStrip = document.querySelector("#templateStrip");
const habitForm = document.querySelector("#habitForm");
const ifThenPreview = document.querySelector("#ifThenPreview");
const difficultyPreview = document.querySelector("#difficultyPreview");
const toast = document.querySelector("#toast");
const installButton = document.querySelector("#installButton");
const cancelEditButton = document.querySelector("#cancelEditButton");
const saveHabitButton = document.querySelector("#saveHabitButton");

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
  {
    name: "レシートを1枚見る",
    why: "お金の流れを把握する",
    category: "home",
    targetAction: "支出を3分だけ確認する",
    tinyAction: "レシートを1枚見る",
    anchor: "夕食のあと",
    fallback: "レシート1枚だけ見て完了にする",
    reminderWindow: "夜",
    days: [0, 3, 6],
  },
];

const categoryIcon = {
  health: "M5 13c2-5 5-7 7-7s5 2 7 7c0 4-3 7-7 7s-7-3-7-7Z",
  learning: "M5 5h10a4 4 0 0 1 4 4v10H9a4 4 0 0 1-4-4V5Zm4 0v14",
  work: "M4 8h16v10H4V8Zm5 0V6h6v2",
  mind: "M12 4c4 0 7 3 7 7 0 5-7 9-7 9s-7-4-7-9c0-4 3-7 7-7Zm0 4v5l3 2",
  home: "M4 11 12 4l8 7v9H6v-7h12",
};

let state = loadState();
let activeView = "today";
let selectedDays = new Set([1, 2, 3, 4, 5]);
let deferredInstallPrompt = null;

init();

function init() {
  applyPreferences();
  renderAll();
  bindEvents();
  registerServiceWorker();
}

function loadState() {
  const fallback = {
    version: 1,
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
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      switchView(viewButton.dataset.view);
      return;
    }

    const logButton = event.target.closest("[data-log-status]");
    if (logButton) {
      recordHabit(logButton.dataset.habitId, logButton.dataset.logStatus);
      return;
    }

    const templateButton = event.target.closest("[data-template-index]");
    if (templateButton) {
      fillTemplate(Number(templateButton.dataset.templateIndex));
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

    const recoverButton = event.target.closest("[data-recover-habit]");
    if (recoverButton) {
      recordHabit(recoverButton.dataset.recoverHabit, "tiny");
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
      return;
    }
  });

  document.querySelector("#weekdayPicker").addEventListener("click", (event) => {
    const button = event.target.closest("[data-day]");
    if (!button) return;
    const day = Number(button.dataset.day);
    if (selectedDays.has(day)) {
      selectedDays.delete(day);
    } else {
      selectedDays.add(day);
    }
    updateWeekdayButtons();
    updatePreview();
  });

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
  renderCreate();
  renderInsights();
  renderSettings();
  updateWeekdayButtons();
  updatePreview();
}

function persistAndRender() {
  saveState();
  applyPreferences();
  renderAll();
}

function switchView(view) {
  activeView = view;
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("is-active", screen.id === `screen-${view}`);
  });
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
  document.querySelector("#mainContent").scrollTo({ top: 0, behavior: "smooth" });
}

function renderToday() {
  const today = toISODate();
  const stats = calculateStats(state.habits, state.logs, {
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
  const dueHabits = getDueHabits(state.habits, today);
  const recovery = getRecoveryCandidates(state.habits, state.logs, today);
  const name = state.profile.name || "今日";
  const completedToday = dueHabits.filter((habit) => {
    const log = getLogForDate(state.logs, habit.id, today);
    return log?.status === "done" || log?.status === "tiny";
  }).length;

  todayRoot.innerHTML = `
    <div class="today-hero">
      <div>
        <p class="eyebrow" id="todayTitle">${formatDisplayDate(today)}</p>
        <h2>${escapeHtml(name)}のフォーカス</h2>
        <p>${buildHeroMessage(dueHabits, completedToday)}</p>
      </div>
      <div class="progress-ring" style="--progress:${stats.consistencyPercent}" aria-label="直近7日のコンシステンシー指数 ${stats.consistencyPercent}%">
        ${stats.consistencyPercent}%
      </div>
    </div>

    <div class="metric-grid" aria-label="直近7日の指標">
      <div class="metric-tile"><span>今日</span><strong>${completedToday}/${dueHabits.length}</strong></div>
      <div class="metric-tile"><span>30日</span><strong>${stats30.consistencyPercent}%</strong></div>
      <div class="metric-tile"><span>復帰</span><strong>${recoveryMetrics.recovered}</strong></div>
    </div>

    ${dueHabits.length > 0 ? renderTinyNow(dueHabits, today) : ""}
    ${recovery.length > 0 ? renderRecovery(recovery[0]) : ""}
    ${dueHabits.length > 0 ? `<div class="habit-stack">${dueHabits.map(renderHabitCard).join("")}</div>` : renderEmptyToday()}
  `;
}

function buildHeroMessage(dueHabits, completedToday) {
  if (state.habits.length === 0) return "まず1つだけ選んで、明日も再現できる形にします。";
  if (dueHabits.length === 0) return "今日は予定のない日です。必要なら最小版だけ残せます。";
  if (completedToday === dueHabits.length) return "今日の予定は完了です。積み上げより、明日戻れる形を保ちます。";
  return "通常版が重い日は、最小版で記録してかまいません。";
}

function renderRecovery(habit) {
  return `
    <div class="recovery-banner">
      <h3>再開チケット</h3>
      <p>昨日の空白は今日の最小版で回収できます。「${escapeHtml(habit.tinyAction)}」から戻します。</p>
      <button class="secondary-button full-width" type="button" data-recover-habit="${habit.id}">最小版で再開</button>
    </div>
  `;
}

function renderTinyNow(dueHabits, today) {
  const items = dueHabits
    .filter((habit) => {
      const log = getLogForDate(state.logs, habit.id, today);
      return !(log?.status === "done" || log?.status === "tiny");
    })
    .slice(0, 3);

  if (items.length === 0) return "";

  return `
    <div class="tiny-now">
      <h3>今すぐできる最小版</h3>
      <div class="tiny-list">
        ${items.map((habit) => `
          <button class="tiny-action" type="button" data-habit-id="${habit.id}" data-log-status="tiny">
            ${escapeHtml(habit.tinyAction)}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderEmptyToday() {
  return `
    <div class="empty-state">
      <h3>最初の1つを選択</h3>
      <p>大きい目標より、生活の中で繰り返せる最小行動を先に置きます。</p>
      <div class="quick-actions">
        ${habitTemplates.map((template, index) => `
          <button class="ghost-button" type="button" data-template-index="${index}">
            ${escapeHtml(template.name)}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderHabitCard(habit) {
  const today = toISODate();
  const log = getLogForDate(state.logs, habit.id, today);
  const status = log?.status || "pending";
  const plan = buildIfThen(habit);
  const iconPath = categoryIcon[habit.category] || categoryIcon.health;
  const lifecycle = getHabitLifecycle(habit, state.logs, today);
  const difficulty = assessHabitDifficulty(habit);
  const reasonOptions = MISSED_REASONS.map((reason) => `
    <option value="${reason.value}" ${log?.reason === reason.value ? "selected" : ""}>${reason.label}</option>
  `).join("");

  return `
    <article class="habit-card ${status === "done" || status === "tiny" ? "confetti" : ""}">
      <header>
        <div>
          <div class="habit-title">
            <span class="habit-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${iconPath}"/></svg></span>
            ${escapeHtml(habit.name)}
          </div>
          <p class="habit-meta">${escapeHtml(habit.reminderWindow)} / ${escapeHtml(lifecycle)} / 難易度${difficulty.label}</p>
        </div>
        <span class="status-pill ${status}">${STATUS_LABELS[status]}</span>
      </header>
      <p class="plan-text">${escapeHtml(plan)}</p>
      ${log?.reason ? `<p class="reason-note">未実行理由: ${escapeHtml(REASON_LABELS[log.reason] || log.reason)}</p>` : ""}
      ${(status === "missed" || status === "later") ? `<p class="recovery-note">復帰プラン: ${escapeHtml(habit.fallback)}</p>` : ""}
      <label class="reason-select">
        未実行理由
        <select data-reason-select="${habit.id}">
          <option value="">選択なし</option>
          ${reasonOptions}
        </select>
      </label>
      <div class="action-grid">
        <button class="primary-button" type="button" data-habit-id="${habit.id}" data-log-status="done">完了</button>
        <button class="secondary-button" type="button" data-habit-id="${habit.id}" data-log-status="tiny">最小版</button>
        <button class="ghost-button" type="button" data-habit-id="${habit.id}" data-log-status="later">明日に回す</button>
        <button class="ghost-button" type="button" data-habit-id="${habit.id}" data-log-status="missed">今日は無理</button>
      </div>
    </article>
  `;
}

function renderCreate() {
  templateStrip.innerHTML = habitTemplates.map((template, index) => `
    <button class="ghost-button" type="button" data-template-index="${index}">
      ${escapeHtml(template.name)}
    </button>
  `).join("");

  managedHabits.innerHTML = state.habits.length === 0
    ? ""
    : state.habits.map((habit) => {
      const difficulty = assessHabitDifficulty(habit);
      const lifecycle = getHabitLifecycle(habit, state.logs, toISODate());
      return `
        <article class="habit-card">
          <header>
            <div>
              <div class="habit-title">${escapeHtml(habit.name)}</div>
              <p class="habit-meta">${escapeHtml(habit.anchor)} / ${escapeHtml(habit.reminderWindow)}</p>
            </div>
            <span class="status-pill pending">${escapeHtml(lifecycle)}</span>
          </header>
          <p class="plan-text">${escapeHtml(buildIfThen(habit))}</p>
          <div class="diagnosis-mini">
            <span>難易度 ${difficulty.label}</span>
            <span>自動化 ${difficulty.automationScore}%</span>
            <span>負荷 ${difficulty.loadScore}%</span>
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

function renderInsights() {
  const today = toISODate();
  const stats = calculateStats(state.habits, state.logs, {
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
  const habitScores = state.habits.map((habit) => {
    const habitStats = calculateStats([habit], state.logs, {
      endIso: today,
      dayCount: 30,
      includeTodayAsEligible: false,
    });
    const difficulty = assessHabitDifficulty(habit);
    return { habit, habitStats, difficulty, lifecycle: getHabitLifecycle(habit, state.logs, today) };
  });

  insightsRoot.innerHTML = `
    <div class="insight-card">
      <h3>直近7日</h3>
      <div class="metric-grid">
        <div class="metric-tile"><span>対象</span><strong>${stats.eligible}</strong></div>
        <div class="metric-tile"><span>完了</span><strong>${stats.totals.completed}</strong></div>
        <div class="metric-tile"><span>指数</span><strong>${stats.consistencyPercent}%</strong></div>
      </div>
      <div class="metric-grid">
        <div class="metric-tile"><span>30日</span><strong>${stats30.consistencyPercent}%</strong></div>
        <div class="metric-tile"><span>復帰成功</span><strong>${recoveryMetrics.recovered}</strong></div>
        <div class="metric-tile"><span>最小版</span><strong>${stats30.totals.tiny}</strong></div>
      </div>
      ${stats.byDay.map((day) => {
        const rate = day.scheduled > 0 ? Math.round((day.completed / day.scheduled) * 100) : 0;
        return `
          <div class="bar-row">
            <span>${day.day}</span>
            <div class="bar-track" aria-label="${day.day}曜日 ${rate}%"><div class="bar-fill" style="width:${rate}%"></div></div>
            <span>${rate}%</span>
          </div>
        `;
      }).join("")}
    </div>

    <div class="insight-card">
      <h3>コーチコメント</h3>
      <p>${escapeHtml(coachComment)}</p>
    </div>

    <div class="insight-card">
      <h3>未実行理由</h3>
      ${recoveryMetrics.topReasons.length > 0 ? `
        <ul class="suggestion-list">
          ${recoveryMetrics.topReasons.slice(0, 4).map((reason) => `
            <li>${escapeHtml(reason.label)}: ${reason.count}回</li>
          `).join("")}
        </ul>
      ` : "<p>まだ理由の記録はありません。</p>"}
    </div>

    <div class="insight-card">
      <h3>習慣ごとの状態</h3>
      ${habitScores.length > 0 ? `
        <div class="habit-score-list">
          ${habitScores.map(({ habit, habitStats, difficulty, lifecycle }) => `
            <div class="habit-score-row">
              <strong>${escapeHtml(habit.name)}</strong>
              <span>${escapeHtml(lifecycle)} / 実行率${habitStats.consistencyPercent}% / 難易度${difficulty.label}</span>
            </div>
          `).join("")}
        </div>
      ` : "<p>習慣を保存すると表示されます。</p>"}
    </div>

    <div class="insight-card">
      <h3>次の調整</h3>
      <ul class="suggestion-list">
        ${suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </div>

    <div class="insight-card">
      <h3>設計メモ</h3>
      <p>習慣は短期の連続記録だけで判断せず、8〜12週間の反復、同じ文脈、ミス後48時間以内の再開を重視します。</p>
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
  const input = {
    id: id || `habit-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
    name: formData.get("name"),
    why: formData.get("why"),
    category: formData.get("category"),
    targetAction: formData.get("targetAction"),
    tinyAction: formData.get("tinyAction"),
    anchor: formData.get("anchor"),
    fallback: formData.get("fallback"),
    reminderWindow: formData.get("reminderWindow"),
    days: [...selectedDays],
    createdAt: id ? state.habits.find((habit) => habit.id === id)?.createdAt : toISODate(),
    paused: id ? state.habits.find((habit) => habit.id === id)?.paused : false,
    graduated: id ? state.habits.find((habit) => habit.id === id)?.graduated : false,
  };

  const errors = validateHabitInput(input);
  if (errors.length > 0) {
    showToast(errors[0]);
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
  showToast(id ? "習慣を更新しました。" : "習慣を保存しました。");
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
  switchView("create");
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
  switchView("create");
}

function deleteHabit(id) {
  const habit = state.habits.find((item) => item.id === id);
  if (!habit) return;
  const confirmed = window.confirm(`「${habit.name}」を削除します。記録も削除されます。`);
  if (!confirmed) return;
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
  showToast(habit.paused ? "習慣を再開しました。" : "習慣を一時停止しました。");
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
  updateWeekdayButtons();
  updatePreview();
}

function recordHabit(habitId, status) {
  const habit = state.habits.find((item) => item.id === habitId);
  if (!habit) return;
  const today = toISODate();
  const reason = status === "missed" || status === "later" ? getSelectedReason(habitId) : "";
  const message = buildStatusMessage(habit, status);
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
  showToast(message);
}

function getSelectedReason(habitId) {
  const select = [...document.querySelectorAll("[data-reason-select]")]
    .find((item) => item.dataset.reasonSelect === habitId);
  return select?.value || "";
}

function buildStatusMessage(habit, status) {
  if (status === "done") return state.profile.gentleTone === false ? "完了しました。" : "通常版で記録しました。";
  if (status === "tiny") return `最小版で十分です。「${habit.tinyAction}」を記録しました。`;
  if (status === "later") return "後で戻れるように残しました。";
  return `今日は休みにしました。次は「${habit.fallback}」。`;
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
    <span>継続難易度: ${difficulty.label}</span>
    <div class="diagnosis-mini">
      <span>自動化 ${difficulty.automationScore}%</span>
      <span>負荷 ${difficulty.loadScore}%</span>
    </div>
    <p>${escapeHtml(difficulty.reasons.slice(0, 2).join(" "))}</p>
    <p>${escapeHtml(difficulty.improvements[0])}</p>
  `;
}

function updateWeekdayButtons() {
  document.querySelectorAll(".weekday-chip").forEach((button) => {
    button.classList.toggle("is-selected", selectedDays.has(Number(button.dataset.day)));
  });
}

function applyPreferences() {
  const theme = state.settings.theme || "system";
  const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  document.body.classList.toggle("large-text", Boolean(state.settings.largeText));
  document.body.classList.toggle("theme-dark", theme === "dark" || (theme === "system" && systemDark));
}

async function requestNotification() {
  if (!("Notification" in window)) {
    showToast("このブラウザでは通知を確認できません。");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    new Notification("つづく設計", { body: "通知はアプリ起動中の確認に使えます。" });
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
    `- 平均復帰日数: ${recoveryMetrics.averageRecoveryDays ?? "未計測"}`,
    "",
    "## 未実行理由",
    ...(recoveryMetrics.topReasons.length > 0
      ? recoveryMetrics.topReasons.map((reason) => `- ${reason.label}: ${reason.count}回`)
      : ["- 記録なし"]),
    "",
    "## 来週の改善案",
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
    showToast("データを読み込みました。");
  } catch {
    showToast("読み込みに失敗しました。");
  } finally {
    event.target.value = "";
  }
}

function resetData() {
  const confirmed = window.confirm("ローカルに保存された習慣と記録をすべて削除します。");
  if (!confirmed) return;
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
  }, 2600);
}

function formatDisplayDate(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    month: "long",
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
    // PWA registration failure should not block the core tracker.
  });
}
