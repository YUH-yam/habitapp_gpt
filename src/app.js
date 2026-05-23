import {
  STATUS_LABELS,
  addDaysISO,
  buildIfThen,
  buildSuggestions,
  calculateStats,
  getDueHabits,
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
const toast = document.querySelector("#toast");
const installButton = document.querySelector("#installButton");
const cancelEditButton = document.querySelector("#cancelEditButton");
const saveHabitButton = document.querySelector("#saveHabitButton");

const habitTemplates = [
  {
    name: "英語を1分読む",
    why: "将来の選択肢を広げる",
    category: "learning",
    targetAction: "英語の記事を5分読む",
    tinyAction: "1文だけ読む",
    anchor: "朝食のあと",
    fallback: "最小版だけ実行して明日の朝食後に戻る",
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
      <div class="metric-tile"><span>最小版</span><strong>${stats.totals.tiny}</strong></div>
      <div class="metric-tile"><span>再開率</span><strong>${stats.restartPercent}%</strong></div>
    </div>

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

  return `
    <article class="habit-card ${status === "done" || status === "tiny" ? "confetti" : ""}">
      <header>
        <div>
          <div class="habit-title">
            <span class="habit-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${iconPath}"/></svg></span>
            ${escapeHtml(habit.name)}
          </div>
          <p class="habit-meta">${escapeHtml(habit.reminderWindow)} / 最小版: ${escapeHtml(habit.tinyAction)}</p>
        </div>
        <span class="status-pill ${status}">${STATUS_LABELS[status]}</span>
      </header>
      <p class="plan-text">${escapeHtml(plan)}</p>
      <div class="action-grid">
        <button class="primary-button" type="button" data-habit-id="${habit.id}" data-log-status="done">完了</button>
        <button class="secondary-button" type="button" data-habit-id="${habit.id}" data-log-status="tiny">最小版</button>
        <button class="ghost-button" type="button" data-habit-id="${habit.id}" data-log-status="later">後で</button>
        <button class="ghost-button" type="button" data-habit-id="${habit.id}" data-log-status="missed">休む</button>
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
    : state.habits.map((habit) => `
      <article class="habit-card">
        <header>
          <div>
            <div class="habit-title">${escapeHtml(habit.name)}</div>
            <p class="habit-meta">${escapeHtml(habit.anchor)} / ${escapeHtml(habit.reminderWindow)}</p>
          </div>
          <span class="status-pill pending">${habit.days.length}日/週</span>
        </header>
        <p class="plan-text">${escapeHtml(buildIfThen(habit))}</p>
        <div class="manage-actions">
          <button class="secondary-button" type="button" data-edit-habit="${habit.id}">編集</button>
          <button class="danger-button" type="button" data-delete-habit="${habit.id}">削除</button>
        </div>
      </article>
    `).join("");
}

function renderInsights() {
  const today = toISODate();
  const stats = calculateStats(state.habits, state.logs, {
    endIso: today,
    dayCount: 7,
    includeTodayAsEligible: false,
  });
  const suggestions = buildSuggestions(state.habits, state.logs, today);

  insightsRoot.innerHTML = `
    <div class="insight-card">
      <h3>直近7日</h3>
      <div class="metric-grid">
        <div class="metric-tile"><span>対象</span><strong>${stats.eligible}</strong></div>
        <div class="metric-tile"><span>完了</span><strong>${stats.totals.completed}</strong></div>
        <div class="metric-tile"><span>指数</span><strong>${stats.consistencyPercent}%</strong></div>
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
  const message = buildStatusMessage(habit, status);
  const log = {
    id: `log-${habitId}-${today}`,
    habitId,
    date: today,
    status,
    note: "",
    createdAt: new Date().toISOString(),
  };
  state.logs = upsertLog(state.logs, log);
  persistAndRender();
  showToast(message);
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
    targetAction: formData.get("targetAction"),
    tinyAction: formData.get("tinyAction"),
    anchor: formData.get("anchor"),
    days: [...selectedDays],
  });
  ifThenPreview.textContent = buildIfThen(previewHabit);
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
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `habit-backup-${toISODate()}.json`;
  link.click();
  URL.revokeObjectURL(url);
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
