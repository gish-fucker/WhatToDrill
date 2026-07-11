const STORAGE_KEY = "habit_fitness_app_v1";
const WORKOUT_DRAFT_KEY = "habit_fitness_workout_draft_v1";
const APP_VERSION = "1.4.0";
const CLOUD_ADVICE_CONSENT_VERSION = 1;
const BACKUP_SCHEMA_VERSION = 1;

const defaultSettings = {
  waterStepMl: 500,
  waterTargetMl: 2000,
  weeklyWorkoutTarget: 2,
  trainingGoal: "general",
  preferredEnvironment: "gym",
  conservativeMode: false,
  dailyReminderEnabled: false,
  dailyReminderTime: "20:30",
  workoutReminderEnabled: false,
  workoutReminderTime: "18:30",
  lastDailyReminderDate: "",
  lastWorkoutReminderDate: "",
  lastBackupAt: "",
  cloudAdviceConsentVersion: 0
};

const defaultExercises = [
  { name: "深蹲", category: "力量", lastUsed: "" },
  { name: "卧推", category: "力量", lastUsed: "" },
  { name: "硬拉", category: "力量", lastUsed: "" },
  { name: "划船", category: "力量", lastUsed: "" },
  { name: "肩推", category: "力量", lastUsed: "" },
  { name: "引体向上", category: "力量", lastUsed: "" },
  { name: "腿举", category: "力量", lastUsed: "" },
  { name: "高位下拉", category: "力量", lastUsed: "" },
  { name: "坐姿划船", category: "力量", lastUsed: "" },
  { name: "哑铃肩推", category: "力量", lastUsed: "" },
  { name: "罗马尼亚硬拉", category: "力量", lastUsed: "" },
  { name: "臀桥", category: "力量", lastUsed: "" },
  { name: "俯卧撑", category: "力量", lastUsed: "" },
  { name: "死虫", category: "核心", lastUsed: "" },
  { name: "跑步", category: "有氧", lastUsed: "" },
  { name: "快走", category: "有氧", lastUsed: "" },
  { name: "动态拉伸", category: "恢复", lastUsed: "" },
  { name: "髋部活动", category: "恢复", lastUsed: "" },
  { name: "平板支撑", category: "核心", lastUsed: "" }
];

const beginnerTemplates = [
  {
    id: "beginner_full_body",
    name: "全身入门",
    duration: 35,
    sessionRpe: 6,
    environment: "健身房",
    exercises: [
      { name: "腿举", sets: beginnerSets(3, "", 10, 6, "动作稳定，保留 3 次余力") },
      { name: "卧推", sets: beginnerSets(3, "", 8, 6, "先用轻重量找轨迹") },
      { name: "坐姿划船", sets: beginnerSets(3, "", 10, 6, "肩胛向后收，不耸肩") },
      { name: "平板支撑", sets: beginnerSets(2, "", 30, 6, "按秒记录在次数里") }
    ]
  },
  {
    id: "beginner_upper",
    name: "上肢入门",
    duration: 30,
    sessionRpe: 6,
    environment: "健身房",
    exercises: [
      { name: "卧推", sets: beginnerSets(3, "", 8, 6, "重量宁轻不乱") },
      { name: "高位下拉", sets: beginnerSets(3, "", 10, 6, "先让背发力") },
      { name: "哑铃肩推", sets: beginnerSets(2, "", 10, 6, "核心收紧") },
      { name: "坐姿划船", sets: beginnerSets(2, "", 10, 6, "控制回放") }
    ]
  },
  {
    id: "beginner_lower",
    name: "下肢入门",
    duration: 32,
    sessionRpe: 6,
    environment: "健身房",
    exercises: [
      { name: "腿举", sets: beginnerSets(3, "", 10, 6, "膝盖方向稳定") },
      { name: "罗马尼亚硬拉", sets: beginnerSets(3, "", 8, 6, "背部保持中立") },
      { name: "臀桥", sets: beginnerSets(3, "", 12, 6, "顶峰停 1 秒") },
      { name: "死虫", sets: beginnerSets(2, "", 10, 5, "慢一点更有效") }
    ]
  },
  {
    id: "beginner_recovery",
    name: "恢复拉伸",
    duration: 15,
    sessionRpe: 3,
    environment: "居家",
    exercises: [
      { name: "快走", sets: beginnerSets(1, "", 10, 3, "按分钟记录在次数里") },
      { name: "动态拉伸", sets: beginnerSets(2, "", 8, 3, "动作轻松，不追求拉到极限") },
      { name: "髋部活动", sets: beginnerSets(2, "", 8, 3, "左右各做") },
      { name: "平板支撑", sets: beginnerSets(2, "", 20, 4, "保持能说话的强度") }
    ]
  }
];

const state = loadState();
let lastWorkoutSummary = null;
let pendingImport = null;
let reminderTimer = null;
let installPromptEvent = null;
let lastStorageIssue = "";
let workoutDraftTimer = null;
let editingWorkoutId = null;
let pendingWorkoutDeleteId = null;
let pendingDailyDeleteDate = null;
let historyFilter = "all";
let historySearch = "";
let historyExpanded = false;
let pendingAppUpdate = null;
let updateReloadRequested = false;
let cloudAdviceConfigured = false;
const onboardingTouched = {
  energy: false,
  soreness: false,
  pain: false
};

function beginnerSets(count, weight, reps, rpe, note) {
  return Array.from({ length: count }, () => ({ weight, reps, rpe, note }));
}

function today() {
  return formatLocalDate(new Date());
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (parsed) {
      return {
        dailyLogs: parsed.dailyLogs || [],
        workouts: parsed.workouts || [],
        exercises: mergeDefaultExercises(parsed.exercises),
        templates: parsed.templates || [],
        adviceHistory: parsed.adviceHistory || [],
        settings: normalizeSettings(parsed.settings)
      };
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }

  return {
    dailyLogs: [],
    workouts: [],
    exercises: mergeDefaultExercises([]),
    templates: [],
    adviceHistory: [],
    settings: normalizeSettings({})
  };
}

function mergeDefaultExercises(exercises = []) {
  const merged = [...(Array.isArray(exercises) ? exercises : [])];
  defaultExercises.forEach(exercise => {
    if (!merged.some(item => item.name === exercise.name)) {
      merged.push({ ...exercise });
    }
  });
  return merged;
}

function saveState() {
  persistState();
  renderAll();
}

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    lastStorageIssue = "";
    return true;
  } catch (error) {
    lastStorageIssue = isStorageQuotaError(error)
      ? "浏览器本地空间不足，当前更改可能只保留在本次页面中。请先导出备份，再清理浏览器存储。"
      : "本地保存失败，当前更改可能没有写入浏览器。请先导出备份后再继续。";
    showToast(lastStorageIssue);
    return false;
  }
}

function isStorageQuotaError(error) {
  return error?.name === "QuotaExceededError" || error?.code === 22 || error?.code === 1014;
}

function $(id) {
  return document.getElementById(id);
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), 2200);
}

function setDateDefaults() {
  $("dailyDate").value = today();
  $("workoutDate").value = today();
}

function bindTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
    tab.addEventListener("keydown", event => {
      let nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabs.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      const nextTab = tabs[nextIndex];
      activateTab(nextTab.dataset.tab, { scroll: false });
      nextTab.focus();
    });
  });
  const activeTab = tabs.find(tab => tab.classList.contains("active")) || tabs[0];
  if (activeTab) activateTab(activeTab.dataset.tab, { scroll: false });
}

function activateTab(tabId, options = {}) {
  const tab = document.querySelector(`.tab[data-tab="${tabId}"]`);
  const panel = $(tabId);
  if (!tab || !panel) return;
  document.querySelectorAll(".tab").forEach(item => {
    const active = item === tab;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", String(active));
    item.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".tab-panel").forEach(item => {
    const active = item === panel;
    item.classList.toggle("active", active);
    item.hidden = !active;
  });
  if (options.scroll !== false) panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bindRanges() {
  ["mood", "energy", "soreness", "pain", "sessionRpe"].forEach(id => {
    const input = $(id);
    const output = $(`${id}Value`);
    input.addEventListener("input", () => {
      output.textContent = input.value;
      if (Object.prototype.hasOwnProperty.call(onboardingTouched, id)) {
        onboardingTouched[id] = true;
        renderStarterGuide();
      }
    });
  });
}

function sanitizeWaterStep(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 500;
  return clamp(Math.round(parsed / 50) * 50, 50, 2000);
}

function sanitizeWaterTarget(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultSettings.waterTargetMl;
  return clamp(Math.round(parsed / 100) * 100, 800, 5000);
}

function sanitizeWeeklyWorkoutTarget(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultSettings.weeklyWorkoutTarget;
  return clamp(Math.round(parsed), 1, 6);
}

function sanitizeReminderTime(value, fallback) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return fallback;
  const [hour, minute] = value.split(":").map(Number);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
  return value;
}

function normalizeSettings(settings = {}) {
  const goalIds = ["general", "fat_loss", "muscle_gain", "strength", "recovery"];
  const environmentIds = ["gym", "home", "mixed"];
  return {
    waterStepMl: sanitizeWaterStep(settings.waterStepMl ?? defaultSettings.waterStepMl),
    waterTargetMl: sanitizeWaterTarget(settings.waterTargetMl ?? defaultSettings.waterTargetMl),
    weeklyWorkoutTarget: sanitizeWeeklyWorkoutTarget(settings.weeklyWorkoutTarget ?? defaultSettings.weeklyWorkoutTarget),
    trainingGoal: goalIds.includes(settings.trainingGoal) ? settings.trainingGoal : defaultSettings.trainingGoal,
    preferredEnvironment: environmentIds.includes(settings.preferredEnvironment) ? settings.preferredEnvironment : defaultSettings.preferredEnvironment,
    conservativeMode: Boolean(settings.conservativeMode),
    dailyReminderEnabled: Boolean(settings.dailyReminderEnabled),
    dailyReminderTime: sanitizeReminderTime(settings.dailyReminderTime ?? defaultSettings.dailyReminderTime, defaultSettings.dailyReminderTime),
    workoutReminderEnabled: Boolean(settings.workoutReminderEnabled),
    workoutReminderTime: sanitizeReminderTime(settings.workoutReminderTime ?? defaultSettings.workoutReminderTime, defaultSettings.workoutReminderTime),
    lastDailyReminderDate: isValidDateText(settings.lastDailyReminderDate) ? settings.lastDailyReminderDate : "",
    lastWorkoutReminderDate: isValidDateText(settings.lastWorkoutReminderDate) ? settings.lastWorkoutReminderDate : "",
    lastBackupAt: Number.isFinite(Date.parse(settings.lastBackupAt)) ? new Date(settings.lastBackupAt).toISOString() : "",
    cloudAdviceConsentVersion: settings.cloudAdviceConsentVersion === CLOUD_ADVICE_CONSENT_VERSION
      ? CLOUD_ADVICE_CONSENT_VERSION
      : 0
  };
}

function goalLabel(goal = state.settings.trainingGoal) {
  return {
    general: "健康入门",
    fat_loss: "减脂",
    muscle_gain: "增肌",
    strength: "力量基础",
    recovery: "恢复优先"
  }[goal] || "健康入门";
}

function environmentLabel(environment = state.settings.preferredEnvironment) {
  return {
    gym: "健身房",
    home: "居家",
    mixed: "都可以"
  }[environment] || "健身房";
}

async function withButtonBusy(buttonId, busyText, action) {
  const button = $(buttonId);
  const previous = button.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = busyText;
  try {
    return await action();
  } finally {
    window.setTimeout(() => {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = previous;
      if (buttonId === "saveWorkoutBtn") updateWorkoutEditMode();
    }, 260);
  }
}

function saveDaily(options = {}) {
  const date = $("dailyDate").value || today();
  const log = {
    id: `daily_${date}`,
    date,
    sleepHours: numberOrNull($("sleepHours").value),
    waterMl: numberOrNull($("waterMl").value),
    mood: Number($("mood").value),
    energy: Number($("energy").value),
    soreness: Number($("soreness").value),
    pain: Number($("pain").value),
    habits: {
      workout: $("habitWorkout").checked,
      stretch: $("habitStretch").checked,
      study: $("habitStudy").checked,
      earlySleep: $("habitEarlySleep").checked
    },
    note: $("dailyNote").value.trim(),
    updatedAt: new Date().toISOString()
  };

  const index = state.dailyLogs.findIndex(item => item.date === date);
  if (index >= 0) {
    state.dailyLogs[index] = log;
  } else {
    state.dailyLogs.push(log);
  }
  onboardingTouched.energy = true;
  onboardingTouched.soreness = true;
  onboardingTouched.pain = true;
  saveState();
  if (!options.silent) showToast("今天的记录已保存");
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function loadDailyIntoForm(date) {
  const log = state.dailyLogs.find(item => item.date === date);
  $("sleepHours").value = log?.sleepHours ?? "";
  $("waterMl").value = log?.waterMl ?? "";
  $("mood").value = log?.mood ?? 3;
  $("energy").value = log?.energy ?? 3;
  $("soreness").value = log?.soreness ?? 2;
  $("pain").value = log?.pain ?? 0;
  $("habitWorkout").checked = Boolean(log?.habits?.workout);
  $("habitStretch").checked = Boolean(log?.habits?.stretch);
  $("habitStudy").checked = Boolean(log?.habits?.study);
  $("habitEarlySleep").checked = Boolean(log?.habits?.earlySleep);
  $("dailyNote").value = log?.note ?? "";
  ["mood", "energy", "soreness", "pain"].forEach(id => $(`${id}Value`).textContent = $(id).value);
  renderDailyCoach();
  renderTodayDashboard();
}

function addWaterServing() {
  const step = sanitizeWaterStep(state.settings.waterStepMl);
  const current = numberOrNull($("waterMl").value) || 0;
  $("waterMl").value = current + step;
  saveDaily({ silent: true });
  showToast(`已记录喝水 +${step} ml`);
}

function changeWaterStep() {
  $("waterStepInput").value = sanitizeWaterStep(state.settings.waterStepMl);
  setFieldError("waterStepError", "");
  openInputDialog("waterStepDialog", "waterStepInput");
}

function saveWaterStep() {
  const input = $("waterStepInput");
  if (!input.checkValidity()) {
    setFieldError("waterStepError", "请输入 50 到 2000 之间、以 50 为步进的数量。");
    input.focus();
    return;
  }
  const parsed = sanitizeWaterStep(input.value);
  state.settings.waterStepMl = parsed;
  saveState();
  updateWaterStepUi();
  closeInputDialog("waterStepDialog");
  showToast(`饮水快捷量已改为 ${parsed} ml`);
}

function updateWaterStepUi() {
  $("waterStepBtn").textContent = `+${sanitizeWaterStep(state.settings.waterStepMl)} ml`;
}

function exerciseOptions(selected = "") {
  return state.exercises
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
    .map(exercise => `<option value="${escapeHtml(exercise.name)}" ${exercise.name === selected ? "selected" : ""}>${escapeHtml(exercise.name)}</option>`)
    .join("");
}

function addExerciseCard(exercise = { name: state.exercises[0]?.name || "", sets: [{ weight: "", reps: "", rpe: 7, note: "" }] }) {
  const card = document.createElement("article");
  card.className = "exercise-card";
  card.dataset.exerciseId = uid("exercise");
  card.innerHTML = `
    <header>
      <span class="exercise-index"></span>
      <div class="exercise-title-row">
        <label>
          动作
          <select class="exercise-name">${exerciseOptions(exercise.name)}</select>
        </label>
        <button class="ghost-button remove-exercise" type="button">移除</button>
      </div>
    </header>
    <div class="exercise-history" aria-live="polite"></div>
    <div class="set-header">
      <span>重量</span>
      <span>次数</span>
      <span>RPE</span>
      <span>备注</span>
    </div>
    <div class="sets"></div>
    <button class="ghost-button add-set" type="button">添加一组</button>
  `;
  $("exerciseRows").appendChild(card);
  const sets = exercise.sets?.length ? exercise.sets : [{ weight: "", reps: "", rpe: 7, note: "" }];
  sets.forEach(set => addSetRow(card, set));
  renderExerciseHistory(card);
  updateExerciseIndexes();
  renderWorkoutExecution();
  renderWorkoutDashboard();
}

function addSetRow(card, set = { weight: "", reps: "", rpe: 7, note: "" }) {
  const row = document.createElement("div");
  row.className = "set-grid";
  const defaultReps = set.reps ?? "";
  const defaultNote = set.note ?? "";
  row.dataset.defaultReps = String(defaultReps);
  row.dataset.defaultNote = String(defaultNote);
  row.innerHTML = `
    <label>
      <span class="set-label">重量</span>
      <input class="set-weight" type="number" min="0" step="0.5" value="${escapeAttr(set.weight ?? "")}">
    </label>
    <label>
      <span class="set-label">次数</span>
      <input class="set-reps" type="number" min="0" step="1" value="${escapeAttr(set.reps ?? "")}">
    </label>
    <label>
      <span class="set-label">RPE</span>
      <input class="set-rpe" type="number" min="1" max="10" step="0.5" value="${escapeAttr(set.rpe ?? 7)}">
    </label>
    <label>
      <span class="set-label">备注</span>
      <input class="set-note" type="text" value="${escapeAttr(set.note ?? "")}">
    </label>
    <button class="ghost-button remove-set" type="button">删除</button>
  `;
  card.querySelector(".sets").appendChild(row);
}

function bindWorkoutRows() {
  $("addExerciseRowBtn").addEventListener("click", () => {
    addExerciseCard();
    scheduleWorkoutDraftSave();
  });
  $("exerciseRows").addEventListener("click", event => {
    const target = event.target;
    const card = target.closest(".exercise-card");
    if (!card) return;
    if (target.classList.contains("add-set")) {
      addSetRow(card);
      renderWorkoutExecution();
      renderWorkoutDashboard();
    }
    if (target.classList.contains("remove-set")) {
      target.closest(".set-grid").remove();
      renderWorkoutExecution();
      renderWorkoutDashboard();
    }
    if (target.classList.contains("remove-exercise")) {
      card.remove();
      updateExerciseIndexes();
      renderWorkoutExecution();
      renderWorkoutDashboard();
    }
    if (target.classList.contains("reuse-last-sets")) {
      reuseLatestExerciseSets(card);
    }
    scheduleWorkoutDraftSave();
  });
  $("exerciseRows").addEventListener("change", event => {
    const card = event.target.closest(".exercise-card");
    if (card && event.target.classList.contains("exercise-name")) renderExerciseHistory(card);
  });
}

function findLatestExerciseHistory(name) {
  if (!name) return null;
  const workouts = state.workouts
    .slice()
    .sort((a, b) => (b.createdAt || b.date || "").localeCompare(a.createdAt || a.date || ""));
  for (const workout of workouts) {
    const exercise = workout.exercises?.find(item => item.name === name && Array.isArray(item.sets) && item.sets.length);
    if (exercise) return { workout, exercise };
  }
  return null;
}

function renderExerciseHistory(card) {
  const panel = card.querySelector(".exercise-history");
  const name = card.querySelector(".exercise-name")?.value;
  const history = findLatestExerciseHistory(name);
  if (!history) {
    panel.innerHTML = "";
    panel.hidden = true;
    return;
  }

  const firstSet = history.exercise.sets[0] || {};
  const setSummary = [
    firstSet.weight !== null && firstSet.weight !== undefined ? `${firstSet.weight}kg` : "",
    firstSet.reps !== null && firstSet.reps !== undefined ? `× ${firstSet.reps}` : ""
  ].filter(Boolean).join(" ");
  panel.hidden = false;
  panel.innerHTML = `
    <div>
      <span>上次 · ${escapeHtml(history.workout.date || "日期未知")}</span>
      <strong>${history.exercise.sets.length} 组${setSummary ? ` · ${escapeHtml(setSummary)}` : ""}</strong>
    </div>
    <button class="ghost-button reuse-last-sets" type="button">填入上次</button>
  `;
}

function reuseLatestExerciseSets(card) {
  const name = card.querySelector(".exercise-name")?.value;
  const history = findLatestExerciseHistory(name);
  if (!history) {
    showToast("还没有这个动作的历史数据");
    renderExerciseHistory(card);
    return;
  }

  const sets = history.exercise.sets.map(set => ({
    weight: set.weight ?? "",
    reps: set.reps ?? "",
    rpe: set.rpe ?? 7,
    note: ""
  }));
  card.querySelector(".sets").innerHTML = "";
  sets.forEach(set => addSetRow(card, set));
  renderWorkoutExecution();
  renderWorkoutDashboard();
  persistWorkoutDraft();
  showToast(`已填入 ${name} 的上次训练数据`);
}

function updateExerciseIndexes() {
  document.querySelectorAll(".exercise-card").forEach((card, index) => {
    const label = card.querySelector(".exercise-index");
    if (label) label.textContent = String(index + 1).padStart(2, "0");
  });
}

function collectWorkoutExercises() {
  return collectExerciseRows({ completedOnly: true });
}

function collectTemplateExercises() {
  return collectExerciseRows({ completedOnly: false });
}

function collectExerciseRows({ completedOnly }) {
  return Array.from(document.querySelectorAll(".exercise-card")).map(card => {
    const name = card.querySelector(".exercise-name").value;
    const sets = Array.from(card.querySelectorAll(".set-grid"))
      .map(row => setFromRow(row))
      .filter(set => completedOnly ? isCompletedSet(set) : hasPlannedSetValue(set))
      .map(cleanSetForStorage);
    return { name, sets };
  }).filter(exercise => exercise.name && exercise.sets.length);
}

function setFromRow(row) {
  return {
    weight: numberOrNull(row.querySelector(".set-weight").value),
    reps: numberOrNull(row.querySelector(".set-reps").value),
    rpe: numberOrNull(row.querySelector(".set-rpe").value),
    note: row.querySelector(".set-note").value.trim(),
    defaultReps: numberOrNull(row.dataset.defaultReps),
    defaultNote: row.dataset.defaultNote || ""
  };
}

function isCompletedSet(set) {
  const repsChanged = set.reps !== null && set.reps !== set.defaultReps;
  return set.weight !== null || repsChanged || isActualSetNote(set.note, set.defaultNote);
}

function hasPlannedSetValue(set) {
  return set.weight !== null || set.reps !== null || set.rpe !== null || Boolean(set.note);
}

function cleanSetForStorage(set) {
  return {
    weight: set.weight,
    reps: set.reps,
    rpe: set.rpe,
    note: set.note
  };
}

function saveWorkout() {
  const exercises = collectWorkoutExercises();
  if (!exercises.length) {
    showToast("请至少记录一个动作和一组数据");
    return;
  }

  const existingIndex = editingWorkoutId
    ? state.workouts.findIndex(item => item.id === editingWorkoutId)
    : -1;
  const existingWorkout = existingIndex >= 0 ? state.workouts[existingIndex] : null;
  const wasEditing = Boolean(existingWorkout);
  const workout = {
    id: existingWorkout?.id || uid("workout"),
    date: $("workoutDate").value || today(),
    title: $("workoutTitle").value.trim() || "未命名训练",
    duration: numberOrNull($("duration").value),
    sessionRpe: Number($("sessionRpe").value),
    note: $("workoutNote").value.trim(),
    exercises,
    createdAt: existingWorkout?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (wasEditing) state.workouts.splice(existingIndex, 1, workout);
  else state.workouts.push(workout);
  refreshExerciseLastUsed();
  lastWorkoutSummary = buildSavedWorkoutSummary(workout);
  editingWorkoutId = null;
  clearWorkoutDraft();
  saveState();
  clearWorkoutForm();
  renderWorkoutExecution();
  showToast(wasEditing ? "训练修改已保存" : "训练已保存");
}

function saveWorkoutWithFeedback() {
  return withButtonBusy("saveWorkoutBtn", "保存中", () => saveWorkout());
}

function refreshExerciseLastUsed() {
  state.exercises.forEach(exercise => {
    exercise.lastUsed = state.workouts
      .filter(workout => workout.exercises?.some(item => item.name === exercise.name))
      .map(workout => workout.date)
      .sort((a, b) => b.localeCompare(a))[0] || "";
  });
}

function clearWorkoutForm() {
  editingWorkoutId = null;
  updateWorkoutEditMode();
  $("workoutDate").value = today();
  $("workoutTitle").value = "";
  $("duration").value = "";
  $("sessionRpe").value = 6;
  $("sessionRpeValue").textContent = "6";
  $("workoutNote").value = "";
  $("exerciseRows").innerHTML = "";
  addExerciseCard();
  renderWorkoutExecution();
  renderWorkoutDashboard();
}

function buildPersistedWorkoutDraft() {
  const exercises = Array.from(document.querySelectorAll(".exercise-card")).map(card => ({
    name: card.querySelector(".exercise-name")?.value || "",
    sets: Array.from(card.querySelectorAll(".set-grid")).map(row => ({
      weight: numberOrNull(row.querySelector(".set-weight").value),
      reps: numberOrNull(row.querySelector(".set-reps").value),
      rpe: numberOrNull(row.querySelector(".set-rpe").value),
      note: row.querySelector(".set-note").value.trim()
    }))
  }));
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    date: $("workoutDate").value || today(),
    title: $("workoutTitle").value.trim(),
    duration: numberOrNull($("duration").value),
    sessionRpe: Number($("sessionRpe").value),
    note: $("workoutNote").value.trim(),
    exercises
  };
}

function hasMeaningfulWorkoutDraft(draft) {
  return Boolean(draft.title || draft.duration !== null || draft.note)
    || draft.exercises.some(exercise => exercise.sets.some(set => (
      set.weight !== null || set.reps !== null || Boolean(set.note)
    )));
}

function persistWorkoutDraft() {
  if (!$("workoutDate")) return;
  const draft = buildPersistedWorkoutDraft();
  try {
    if (hasMeaningfulWorkoutDraft(draft)) localStorage.setItem(WORKOUT_DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(WORKOUT_DRAFT_KEY);
  } catch (error) {
    lastStorageIssue = isStorageQuotaError(error)
      ? "浏览器本地空间不足，未完成训练草稿无法自动保存。"
      : "未完成训练草稿自动保存失败。";
    renderDataHealth();
  }
}

function scheduleWorkoutDraftSave() {
  window.clearTimeout(workoutDraftTimer);
  workoutDraftTimer = window.setTimeout(persistWorkoutDraft, 300);
}

function clearWorkoutDraft() {
  window.clearTimeout(workoutDraftTimer);
  workoutDraftTimer = null;
  try {
    localStorage.removeItem(WORKOUT_DRAFT_KEY);
  } catch {
    lastStorageIssue = "浏览器拒绝删除未完成训练草稿。";
  }
}

function restoreWorkoutDraft() {
  try {
    const raw = localStorage.getItem(WORKOUT_DRAFT_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    const savedAt = Date.parse(draft.savedAt);
    const expired = !Number.isFinite(savedAt) || Date.now() - savedAt > 14 * 86400000;
    if (draft.version !== 1 || expired || !Array.isArray(draft.exercises)) {
      localStorage.removeItem(WORKOUT_DRAFT_KEY);
      return false;
    }

    $("workoutDate").value = isValidDateText(draft.date) ? draft.date : today();
    $("workoutTitle").value = typeof draft.title === "string" ? draft.title : "";
    $("duration").value = draft.duration ?? "";
    $("sessionRpe").value = draft.sessionRpe ?? 6;
    $("sessionRpeValue").textContent = $("sessionRpe").value;
    $("workoutNote").value = typeof draft.note === "string" ? draft.note : "";
    $("exerciseRows").innerHTML = "";
    draft.exercises.forEach(exercise => addExerciseCard({
      name: exercise.name,
      sets: Array.isArray(exercise.sets) ? exercise.sets : []
    }));
    return true;
  } catch {
    try {
      localStorage.removeItem(WORKOUT_DRAFT_KEY);
    } catch {
      // The storage health panel will surface persistent browser storage failures.
    }
    return false;
  }
}

function updateWorkoutEditMode() {
  const isEditing = Boolean(editingWorkoutId);
  $("saveWorkoutBtn").textContent = isEditing ? "保存修改" : "保存训练";
  $("cancelWorkoutEditBtn").hidden = !isEditing;
}

function editWorkoutRecord(workoutId) {
  const workout = state.workouts.find(item => item.id === workoutId);
  if (!workout) {
    showToast("这条训练记录已不存在");
    renderHistory();
    return;
  }

  editingWorkoutId = workout.id;
  updateWorkoutEditMode();
  $("workoutDate").value = workout.date || today();
  $("workoutTitle").value = workout.title || "";
  $("duration").value = workout.duration ?? "";
  $("sessionRpe").value = workout.sessionRpe ?? 6;
  $("sessionRpeValue").textContent = $("sessionRpe").value;
  $("workoutNote").value = workout.note || "";
  $("exerciseRows").innerHTML = "";
  workout.exercises.forEach(exercise => addExerciseCard(cloneExercise(exercise)));
  lastWorkoutSummary = null;
  persistWorkoutDraft();
  renderWorkoutExecution();
  renderWorkoutDashboard();
  activateTab("workout");
  showToast("已载入训练记录，可以修改后保存");
}

function cancelWorkoutEdit() {
  if (!editingWorkoutId) return;
  clearWorkoutDraft();
  clearWorkoutForm();
  renderAll();
  showToast("已取消修改，原记录保持不变");
}

function openDeleteWorkoutDialog(workoutId) {
  const workout = state.workouts.find(item => item.id === workoutId);
  if (!workout) {
    showToast("这条训练记录已不存在");
    renderHistory();
    return;
  }
  pendingWorkoutDeleteId = workout.id;
  $("deleteWorkoutSummary").textContent = `${workout.date} · ${workout.title} · ${countSets(workout)} 组`;
  const dialog = $("deleteWorkoutDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  $("cancelDeleteWorkoutBtn").focus();
}

function closeDeleteWorkoutDialog() {
  pendingWorkoutDeleteId = null;
  const dialog = $("deleteWorkoutDialog");
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function confirmDeleteWorkout() {
  if (!pendingWorkoutDeleteId) return;
  const workoutId = pendingWorkoutDeleteId;
  const before = state.workouts.length;
  state.workouts = state.workouts.filter(item => item.id !== workoutId);
  if (state.workouts.length === before) {
    closeDeleteWorkoutDialog();
    showToast("这条训练记录已不存在");
    return;
  }
  if (editingWorkoutId === workoutId) {
    clearWorkoutDraft();
    clearWorkoutForm();
  }
  refreshExerciseLastUsed();
  closeDeleteWorkoutDialog();
  saveState();
  showToast("训练记录已删除");
}

function editDailyRecord(date) {
  const log = state.dailyLogs.find(item => item.date === date);
  if (!log) {
    showToast("这天的状态记录已不存在");
    renderHistory();
    return;
  }
  $("dailyDate").value = log.date;
  loadDailyIntoForm(log.date);
  activateTab("today");
  $("sleepHours").focus();
  showToast("已载入这天的状态，修改后保存即可");
}

function openDeleteDailyDialog(date) {
  const log = state.dailyLogs.find(item => item.date === date);
  if (!log) {
    showToast("这天的状态记录已不存在");
    renderHistory();
    return;
  }
  pendingDailyDeleteDate = log.date;
  $("deleteDailySummary").textContent = `${log.date} · 睡眠 ${log.sleepHours ?? "未填"}h · 疼痛 ${log.pain}/5`;
  const dialog = $("deleteDailyDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  $("cancelDeleteDailyBtn").focus();
}

function closeDeleteDailyDialog() {
  pendingDailyDeleteDate = null;
  const dialog = $("deleteDailyDialog");
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function confirmDeleteDaily() {
  if (!pendingDailyDeleteDate) return;
  const date = pendingDailyDeleteDate;
  const before = state.dailyLogs.length;
  state.dailyLogs = state.dailyLogs.filter(item => item.date !== date);
  closeDeleteDailyDialog();
  if (state.dailyLogs.length === before) {
    showToast("这天的状态记录已不存在");
    return;
  }
  if ($("dailyDate").value === date) loadDailyIntoForm(date);
  saveState();
  showToast("日常状态记录已删除");
}

function buildSavedWorkoutSummary(workout) {
  const sets = countSets(workout);
  const suggestion = workout.sessionRpe >= 8
    ? "今天强度偏高，下次先维持重量和组数。"
    : workout.sessionRpe <= 4
      ? "今天强度很轻松，下次可以小幅增加一组或一点重量。"
      : "节奏不错，下次先保持动作质量，再考虑小幅推进。";
  return {
    title: workout.title,
    exercises: workout.exercises.length,
    sets,
    sessionRpe: workout.sessionRpe,
    suggestion
  };
}

function saveTemplate() {
  const exercises = collectTemplateExercises();
  if (!exercises.length) {
    showToast("请先填写动作，再保存模板");
    return;
  }
  $("templateNameInput").value = $("workoutTitle").value.trim() || "常用训练";
  setFieldError("templateNameError", "");
  openInputDialog("templateNameDialog", "templateNameInput");
}

function confirmSaveTemplate() {
  const name = $("templateNameInput").value.trim();
  if (!name) {
    setFieldError("templateNameError", "请输入模板名称。");
    $("templateNameInput").focus();
    return;
  }
  if (getAllTemplates().some(template => template.name.toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN"))) {
    setFieldError("templateNameError", "已经有同名模板，请换一个名称。");
    $("templateNameInput").focus();
    return;
  }
  const exercises = collectTemplateExercises();
  if (!exercises.length) {
    closeInputDialog("templateNameDialog");
    showToast("当前训练没有可保存的动作");
    return;
  }
  state.templates.push({
    id: uid("template"),
    name,
    exercises,
    createdAt: new Date().toISOString()
  });
  saveState();
  closeInputDialog("templateNameDialog");
  showToast("模板已保存");
}

function openInputDialog(dialogId, inputId) {
  const dialog = $(dialogId);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  $(inputId).focus();
  $(inputId).select();
}

function closeInputDialog(dialogId) {
  const dialog = $(dialogId);
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function setFieldError(errorId, message) {
  const error = $(errorId);
  error.textContent = message;
  error.hidden = !message;
}

function loadTemplate() {
  const id = $("templateSelect").value;
  const template = getAllTemplates().find(item => item.id === id);
  if (!template) {
    showToast("还没有可载入的模板");
    return;
  }
  fillWorkoutFromTemplate(template, template.name);
  showToast("模板已载入");
}

function fillWorkoutFromTemplate(template, title) {
  editingWorkoutId = null;
  updateWorkoutEditMode();
  $("workoutDate").value = today();
  $("workoutTitle").value = title || template.name;
  $("duration").value = template.duration ?? "";
  $("sessionRpe").value = template.sessionRpe ?? 6;
  $("sessionRpeValue").textContent = $("sessionRpe").value;
  $("workoutNote").value = template.environment
    ? `今日建议：${template.environment} · 新手友好强度`
    : "";
  $("exerciseRows").innerHTML = "";
  template.exercises.forEach(exercise => addExerciseCard(cloneExercise(exercise)));
  lastWorkoutSummary = null;
  renderWorkoutExecution();
  renderWorkoutDashboard();
  persistWorkoutDraft();
}

function cloneExercise(exercise) {
  return {
    name: exercise.name,
    sets: (exercise.sets || []).map(set => ({ ...set }))
  };
}

function getAllTemplates() {
  return [
    ...beginnerTemplates.map(template => ({ ...template, builtIn: true })),
    ...state.templates.map(template => ({ ...template, builtIn: false }))
  ];
}

function startDailyCoachWorkout() {
  const recommendation = buildDailyCoachRecommendation();
  fillWorkoutFromTemplate(recommendation.template, `今日建议 - ${recommendation.template.name}`);
  activateTab("workout");
  showToast(`已载入${recommendation.template.name}`);
}

function addLibraryExercise() {
  const name = $("newExerciseName").value.trim();
  const category = $("newExerciseCategory").value;
  if (!name) {
    showToast("请输入动作名称");
    return;
  }
  if (state.exercises.some(item => item.name === name)) {
    showToast("动作已存在");
    return;
  }
  state.exercises.push({ name, category, lastUsed: "" });
  $("newExerciseName").value = "";
  saveState();
  showToast("动作已添加");
}

function renderSummary() {
  const recentDaily = getRecent(state.dailyLogs, 14);
  const recentWorkouts = getRecent(state.workouts, 14);
  const avgSleep = average(recentDaily.map(item => item.sleepHours).filter(value => value !== null));
  const avgEnergy = average(recentDaily.map(item => item.energy));
  const totalSets = recentWorkouts.reduce((sum, workout) => sum + workout.exercises.reduce((inner, exercise) => inner + exercise.sets.length, 0), 0);
  const habitRate = recentDaily.length ? Math.round(recentDaily.filter(item => item.habits?.workout).length / recentDaily.length * 100) : 0;

  $("summaryGrid").innerHTML = [
    summaryCard("14天训练", `${recentWorkouts.length} 次`, "Workout"),
    summaryCard("训练组数", `${totalSets} 组`, "Volume"),
    summaryCard("平均睡眠", avgSleep === null ? "暂无" : `${avgSleep.toFixed(1)}h`, "Recovery"),
    summaryCard("健身打卡率", `${habitRate}%`, "Habit"),
    summaryCard("平均精力", avgEnergy === null ? "暂无" : `${avgEnergy.toFixed(1)}/5`, "Energy")
  ].join("");
}

function summaryCard(label, value, eyebrow = "Metric") {
  return `<article class="summary-card"><span class="eyebrow">${escapeHtml(eyebrow)}</span><span class="muted">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}

function renderExerciseProgress() {
  const panel = $("exerciseProgress");
  if (!panel) return;
  const progress = buildExerciseProgress();
  const cards = progress.items.length
    ? progress.items.map(exerciseProgressCard).join("")
    : emptyState("还没有可分析的动作", "保存至少 2 次包含重量、次数或 RPE 的训练后，这里会显示动作进步。");

  panel.innerHTML = `
    <div class="progress-heading">
      <div>
        <p class="eyebrow">Exercise Progress</p>
        <h3>动作进步</h3>
        <p class="muted">${escapeHtml(progress.summary)}</p>
      </div>
      <span class="type-pill">${escapeHtml(progress.coverage)}</span>
    </div>
    <div class="exercise-progress-grid">
      ${cards}
    </div>
  `;
}

function exerciseProgressCard(item) {
  return `
    <article class="exercise-progress-card">
      <header>
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <span class="muted">${escapeHtml(item.category)}</span>
        </div>
        <span class="confidence-pill ${escapeAttr(item.level)}">${escapeHtml(item.levelLabel)}</span>
      </header>
      <div class="exercise-progress-metrics">
        ${exerciseProgressMetric("最近", item.latestText)}
        ${exerciseProgressMetric("最佳", item.bestText)}
        ${exerciseProgressMetric("次数", `${item.sessions} 次`)}
      </div>
      <p>${escapeHtml(item.suggestion)}</p>
    </article>
  `;
}

function exerciseProgressMetric(label, value) {
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function buildExerciseProgress() {
  const exerciseMap = new Map();
  const recentWorkouts = state.workouts
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-12);

  recentWorkouts.forEach(workout => {
    workout.exercises.forEach(exercise => {
      const usableSets = (exercise.sets || []).filter(set => (
        set.weight !== null || set.reps !== null || set.rpe !== null || set.note
      ));
      if (!usableSets.length) return;
      const entry = exerciseMap.get(exercise.name) || {
        name: exercise.name,
        category: state.exercises.find(item => item.name === exercise.name)?.category || "训练",
        sessions: 0,
        sets: [],
        latestDate: "",
        latestBest: null,
        bestEstimate: null
      };
      const bestSet = pickBestSet(usableSets);
      const estimate = estimateSetStrength(bestSet);
      entry.sessions += 1;
      entry.sets.push(...usableSets);
      entry.latestDate = workout.date;
      entry.latestBest = bestSet;
      if (estimate !== null && (entry.bestEstimate === null || estimate > entry.bestEstimate)) {
        entry.bestEstimate = estimate;
      }
      exerciseMap.set(exercise.name, entry);
    });
  });

  const items = Array.from(exerciseMap.values())
    .map(buildExerciseProgressItem)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  return {
    coverage: items.length ? `${items.length} 个动作` : "等待训练",
    summary: items.length
      ? "用最近训练记录整理动作趋势，帮你决定下次是保持、补记录还是小幅推进。"
      : "动作进步需要真实训练组数据，先从一次完整训练记录开始。",
    items
  };
}

function buildExerciseProgressItem(entry) {
  const bestText = entry.bestEstimate === null ? "暂无" : `${formatMetric(entry.bestEstimate)}`;
  const latestText = formatSetSummary(entry.latestBest);
  const level = entry.sessions >= 3 ? "high" : entry.sessions >= 2 ? "medium" : "low";
  const levelLabel = entry.sessions >= 3 ? "可判断" : entry.sessions >= 2 ? "初步趋势" : "样本少";
  const suggestion = buildExerciseProgressSuggestion(entry, level);
  const score = entry.sessions * 10 + entry.sets.length + (entry.bestEstimate || 0) / 100;

  return {
    name: entry.name,
    category: entry.category,
    sessions: entry.sessions,
    latestText,
    bestText,
    level,
    levelLabel,
    suggestion,
    score
  };
}

function pickBestSet(sets) {
  return sets.slice().sort((a, b) => (estimateSetStrength(b) || 0) - (estimateSetStrength(a) || 0))[0];
}

function estimateSetStrength(set) {
  const weight = Number(set.weight || 0);
  const reps = Number(set.reps || 0);
  if (!weight && !reps) return null;
  if (!weight) return reps;
  if (!reps) return weight;
  return Math.round(weight * (1 + reps / 30));
}

function formatSetSummary(set) {
  if (!set) return "暂无";
  const parts = [];
  if (set.weight !== null && set.weight !== undefined && set.weight !== "") parts.push(`${set.weight}kg`);
  if (set.reps !== null && set.reps !== undefined && set.reps !== "") parts.push(`${set.reps}次`);
  if (set.rpe !== null && set.rpe !== undefined && set.rpe !== "") parts.push(`RPE ${set.rpe}`);
  return parts.join(" · ") || "已记录";
}

function buildExerciseProgressSuggestion(entry, level) {
  const latestRpe = entry.latestBest?.rpe ?? null;
  if (level === "low") return "先再记录 1 到 2 次同一动作，趋势会更可靠。";
  if (latestRpe !== null && latestRpe >= 8) return "最近强度偏高，下次先维持重量和次数，优先动作质量。";
  if (entry.sessions >= 3 && latestRpe !== null && latestRpe <= 6) return "完成感稳定，下次可以小幅加重量或多做一组。";
  return "保持同一动作和相近组数，继续观察重量、次数和 RPE 是否稳定。";
}

function renderHistory() {
  const normalizedSearch = historySearch.trim().toLocaleLowerCase("zh-CN");
  const records = [
    ...state.dailyLogs.map(item => ({ type: "daily", date: item.date, timestamp: item.updatedAt || item.date, item })),
    ...state.workouts.map(item => ({ type: "workout", date: item.date, timestamp: item.updatedAt || item.createdAt || item.date, item }))
  ]
    .filter(record => historyFilter === "all" || record.type === historyFilter)
    .filter(record => !normalizedSearch || historySearchText(record).includes(normalizedSearch))
    .sort((a, b) => b.date.localeCompare(a.date) || b.timestamp.localeCompare(a.timestamp));
  const visibleRecords = historyExpanded ? records : records.slice(0, 8);

  $("historyList").innerHTML = visibleRecords.map(record => (
    record.type === "workout" ? workoutHistoryCard(record.item) : dailyHistoryCard(record.item)
  )).join("") || `<p class="muted">${normalizedSearch ? "没有找到匹配的历史记录。" : "当前筛选下还没有历史记录。"}</p>`;

  $("historySearch").value = historySearch;
  $("historyFilter").value = historyFilter;
  $("toggleHistoryBtn").hidden = records.length <= 8;
  $("toggleHistoryBtn").textContent = historyExpanded ? "收起" : `查看全部（${records.length}）`;
}

function historySearchText(record) {
  const item = record.item;
  const fields = record.type === "workout"
    ? [item.date, item.title, item.note, ...item.exercises.map(exercise => exercise.name)]
    : [item.date, item.note];
  return fields.filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
}

function dailyHistoryCard(log) {
  return `
    <article class="history-card" data-daily-date="${escapeAttr(log.date)}">
      <header><strong>${escapeHtml(log.date)}</strong><span class="type-pill">日常</span></header>
      <p class="muted">睡眠 ${log.sleepHours ?? "未填"}h · 精力 ${log.energy}/5 · 心情 ${log.mood}/5 · 疼痛 ${log.pain}/5</p>
      ${log.note ? `<p>${escapeHtml(log.note)}</p>` : ""}
      <div class="history-card-actions">
        <button class="ghost-button edit-daily-record" type="button">修改</button>
        <button class="danger-button delete-daily-record" type="button">删除</button>
      </div>
    </article>
  `;
}

function workoutHistoryCard(workout) {
  return `
    <article class="history-card" data-workout-id="${escapeAttr(workout.id)}">
      <header>
        <strong>${escapeHtml(workout.date)} ${escapeHtml(workout.title)}</strong>
        <span class="type-pill workout-pill">训练</span>
      </header>
      <p class="muted">${workout.exercises.length} 个动作 · ${countSets(workout)} 组 · RPE ${workout.sessionRpe}/10</p>
      <p>${workout.exercises.map(item => escapeHtml(item.name)).join("、")}</p>
      <div class="history-card-actions">
        <button class="ghost-button edit-workout-record" type="button">修改</button>
        <button class="danger-button delete-workout-record" type="button">删除</button>
      </div>
    </article>
  `;
}

function renderLibrary() {
  $("exerciseLibraryList").innerHTML = state.exercises
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
    .map(item => `
      <article class="library-item">
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <span class="muted">${escapeHtml(item.category)}</span>
        </div>
        <span class="type-pill">${item.lastUsed ? `最近 ${escapeHtml(item.lastUsed)}` : "未使用"}</span>
      </article>
    `)
    .join("") || emptyState("还没有动作", "添加第一个动作后，训练记录会更快。");

  const allTemplates = getAllTemplates();
  $("templateList").innerHTML = allTemplates.length
    ? allTemplates.map(template => `
      <article class="template-card">
        <header>
          <strong>${escapeHtml(template.name)}</strong>
          ${template.builtIn
            ? `<span class="type-pill">新手推荐</span>`
            : `<button class="ghost-button delete-template" data-id="${template.id}" type="button">删除</button>`}
        </header>
        <p class="muted">${template.exercises.map(item => escapeHtml(item.name)).join("、")}</p>
        <div class="template-meta">
          <span>${template.exercises.length} 个动作</span>
          <span>${template.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0)} 组</span>
          ${template.duration ? `<span>${template.duration} 分钟</span>` : ""}
        </div>
      </article>
    `).join("")
    : emptyState("还没有模板", "在训练页把常用动作保存为模板。");

  $("templateSelect").innerHTML = allTemplates.length
    ? allTemplates.map(template => `<option value="${template.id}">${template.builtIn ? "新手 · " : ""}${escapeHtml(template.name)}</option>`).join("")
    : `<option value="">暂无模板</option>`;

  renderPreferences();
  renderDataHealth();
  renderImportPreview();
}

function renderPreferences() {
  if (!$("preferenceForm")) return;
  $("trainingGoal").value = state.settings.trainingGoal;
  $("preferredEnvironment").value = state.settings.preferredEnvironment;
  $("weeklyWorkoutTarget").value = state.settings.weeklyWorkoutTarget;
  $("waterTargetMl").value = state.settings.waterTargetMl;
  $("conservativeMode").checked = state.settings.conservativeMode;
  $("dailyReminderEnabled").checked = state.settings.dailyReminderEnabled;
  $("dailyReminderTime").value = state.settings.dailyReminderTime;
  $("workoutReminderEnabled").checked = state.settings.workoutReminderEnabled;
  $("workoutReminderTime").value = state.settings.workoutReminderTime;
  renderReminderStatus();
}

function savePreferences() {
  state.settings = normalizeSettings({
    ...state.settings,
    trainingGoal: $("trainingGoal").value,
    preferredEnvironment: $("preferredEnvironment").value,
    weeklyWorkoutTarget: $("weeklyWorkoutTarget").value,
    waterTargetMl: $("waterTargetMl").value,
    conservativeMode: $("conservativeMode").checked,
    dailyReminderEnabled: $("dailyReminderEnabled").checked,
    dailyReminderTime: $("dailyReminderTime").value,
    workoutReminderEnabled: $("workoutReminderEnabled").checked,
    workoutReminderTime: $("workoutReminderTime").value
  });
  saveState();
  startReminderScheduler();
  showToast("偏好已保存，提醒和建议会按你的目标调整");
}

function getNotificationPermission() {
  if (window.__testNotificationPermission) return window.__testNotificationPermission;
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function buildReminderStatus() {
  const permission = getNotificationPermission();
  const enabled = state.settings.dailyReminderEnabled || state.settings.workoutReminderEnabled;
  if (permission === "unsupported") {
    return {
      level: "low",
      title: "此浏览器不支持系统提醒",
      text: "偏好会保存在本机，但当前浏览器不能弹出通知。",
      action: ""
    };
  }
  if (!enabled) {
    return {
      level: "low",
      title: "本地提醒未开启",
      text: "开启后，页面打开期间会按你设置的时间提醒记录状态或完成训练目标。",
      action: permission === "default" ? "允许系统提醒" : ""
    };
  }
  if (permission === "granted") {
    const parts = [];
    if (state.settings.dailyReminderEnabled) parts.push(`每日 ${state.settings.dailyReminderTime} 记录`);
    if (state.settings.workoutReminderEnabled) parts.push(`训练 ${state.settings.workoutReminderTime} 检查`);
    return {
      level: "high",
      title: "本地提醒已就绪",
      text: `${parts.join(" · ")}。提醒只在当前浏览器本地运行。`,
      action: ""
    };
  }
  if (permission === "denied") {
    return {
      level: "medium",
      title: "提醒已配置，但浏览器权限被关闭",
      text: "如需系统通知，请在浏览器站点设置里重新允许通知权限。",
      action: ""
    };
  }
  return {
    level: "medium",
    title: "提醒已配置，等待通知权限",
    text: "点击允许后，应用会在设定时间提醒你补记录或训练。",
    action: "允许系统提醒"
  };
}

function renderReminderStatus() {
  const panel = $("reminderStatus");
  if (!panel) return;
  const status = buildReminderStatus();
  panel.innerHTML = `
    <div class="reminder-status-heading">
      <div>
        <strong>${escapeHtml(status.title)}</strong>
        <p class="muted">${escapeHtml(status.text)}</p>
      </div>
      <span class="confidence-pill ${escapeAttr(status.level)}">${escapeHtml(reminderPermissionLabel())}</span>
    </div>
    ${status.action ? `<button id="requestNotificationBtn" class="ghost-button" type="button">${escapeHtml(status.action)}</button>` : ""}
  `;
}

function reminderPermissionLabel() {
  return {
    granted: "已允许",
    denied: "已关闭",
    default: "待授权",
    unsupported: "不支持"
  }[getNotificationPermission()] || "待授权";
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    showToast("当前浏览器不支持系统提醒");
    renderReminderStatus();
    return;
  }
  const permission = await Notification.requestPermission();
  showToast(permission === "granted" ? "系统提醒已允许" : "提醒权限未开启");
  renderReminderStatus();
  startReminderScheduler();
}

function emptyState(title, text) {
  return `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <p class="muted">${escapeHtml(text)}</p>
    </div>
  `;
}

function renderDataHealth() {
  const panel = $("dataHealth");
  if (!panel) return;
  const health = buildDataHealth();
  panel.innerHTML = `
    <div class="data-health-heading">
      <strong>${escapeHtml(health.title)}</strong>
      <span class="confidence-pill ${escapeAttr(health.level)}">${escapeHtml(health.label)}</span>
    </div>
    <div class="data-health-grid">
      ${health.metrics.map(metric => `
        <article>
          <span>${escapeHtml(metric.label)}</span>
          <strong>${escapeHtml(metric.value)}</strong>
        </article>
      `).join("")}
    </div>
    <p class="muted">${escapeHtml(health.note)}</p>
  `;
}

function buildDataHealth() {
  const dailyCount = state.dailyLogs.length;
  const workoutCount = state.workouts.length;
  const latestDaily = state.dailyLogs.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  const latestWorkout = state.workouts.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  const totalSets = state.workouts.reduce((sum, workout) => sum + countSets(workout), 0);
  const hasUsefulBackupData = dailyCount >= 3 || workoutCount >= 1;
  const backup = getBackupStatus(state.settings.lastBackupAt);
  const level = lastStorageIssue
    ? "medium"
    : hasUsefulBackupData && backup.ageDays !== null && backup.ageDays <= 7
      ? "high"
      : dailyCount || workoutCount ? "medium" : "low";
  const label = lastStorageIssue
    ? "存储需处理"
    : !dailyCount && !workoutCount ? "暂无数据"
      : hasUsefulBackupData && backup.ageDays === null ? "待备份"
        : backup.ageDays !== null && backup.ageDays <= 7 ? "备份正常"
          : backup.ageDays !== null && backup.ageDays > 30 ? "备份过期" : "建议备份";
  const note = lastStorageIssue || (!dailyCount && !workoutCount
    ? "还没有本地记录。导入前会先预览，避免误覆盖。"
    : hasUsefulBackupData && backup.ageDays === null
      ? "当前数据尚未做过完整 JSON 备份。清理浏览器或更换设备前请先导出。"
      : backup.ageDays !== null && backup.ageDays > 30
        ? "上次完整备份已超过 30 天，建议现在导出新的 JSON。"
        : backup.ageDays !== null && backup.ageDays <= 7
          ? "完整 JSON 备份较新。仍建议在重要训练周期结束后再次导出。"
          : "已有本地记录，建议定期导出 JSON 完整备份。");

  return {
    level,
    label,
    title: "数据健康",
    note,
    metrics: [
      { label: "日常", value: `${dailyCount} 条` },
      { label: "训练", value: `${workoutCount} 次` },
      { label: "组数", value: `${totalSets} 组` },
      { label: "最新", value: latestWorkout?.date || latestDaily?.date || "暂无" },
      { label: "完整备份", value: backup.label },
      { label: "存储", value: lastStorageIssue ? "需处理" : "正常" }
    ]
  };
}

function getBackupStatus(timestamp) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return { ageDays: null, label: "从未备份" };
  const ageDays = Math.max(0, Math.floor((Date.now() - parsed) / 86400000));
  if (ageDays === 0) return { ageDays, label: "今天" };
  if (ageDays === 1) return { ageDays, label: "昨天" };
  return { ageDays, label: `${ageDays} 天前` };
}

function renderImportPreview() {
  const panel = $("importPreview");
  if (!panel) return;
  if (!pendingImport) {
    panel.innerHTML = `
      <div class="import-empty">
        <strong>导入前会先预览</strong>
        <p class="muted">选择 JSON 后，系统会检查记录数量、日期格式和训练组结构。</p>
      </div>
    `;
    return;
  }

  const preview = pendingImport.preview;
  const issueList = preview.issues.length
    ? preview.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join("")
    : `<li>未发现阻塞问题。</li>`;
  panel.innerHTML = `
    <div class="import-card ${preview.canImport ? "" : "blocked"}">
      <div class="import-heading">
        <div>
          <strong>${escapeHtml(preview.fileName)}</strong>
          <p class="muted">${escapeHtml(preview.summary)}</p>
        </div>
        <span class="confidence-pill ${preview.canImport ? "medium" : "low"}">${preview.canImport ? "可导入" : "需修复"}</span>
      </div>
      <div class="import-metrics">
        ${preview.metrics.map(metric => `
          <article>
            <span>${escapeHtml(metric.label)}</span>
            <strong>${escapeHtml(metric.value)}</strong>
          </article>
        `).join("")}
      </div>
      <ul class="import-issues">${issueList}</ul>
      <div class="import-actions">
        <button id="confirmImportBtn" type="button" ${preview.canImport ? "" : "disabled"}>确认覆盖本地数据</button>
        <button id="cancelImportBtn" class="ghost-button" type="button">取消导入</button>
      </div>
    </div>
  `;
}

function renderWorkoutExerciseOptions() {
  document.querySelectorAll(".exercise-name").forEach(select => {
    const current = select.value;
    select.innerHTML = exerciseOptions(current);
  });
}

function renderAdvice() {
  const latest = state.adviceHistory.at(-1);
  if (latest) {
    $("adviceOutput").innerHTML = coachPanel(latest);
  } else {
    $("adviceOutput").innerHTML = `
      <div class="coach-empty">
        <strong>等待你的第一份建议</strong>
        <p class="muted">保存几条生活和训练记录后，系统会把睡眠、精力、疼痛和训练负荷整理成可执行建议。</p>
      </div>
    `;
  }
}

function coachPanel(advice) {
  const sections = parseAdviceSections(advice.text);
  const generatedAt = advice.createdAt.slice(0, 16).replace("T", " ");
  const primary = sections[0];
  const rest = sections.slice(1);

  return `
    <div class="coach-panel">
      <div class="coach-hero">
        <div>
          <span class="type-pill">${escapeHtml(advice.source)}</span>
          <h4>${escapeHtml(primary?.title || "本次建议")}</h4>
          <p>${escapeHtml(primary?.items?.[0] || "记录越完整，建议越具体。")}</p>
        </div>
        <span class="coach-time">${escapeHtml(generatedAt)}</span>
      </div>
      <div class="coach-grid">
        ${rest.map(section => coachSection(section)).join("")}
      </div>
      ${sections.length <= 1 ? `<pre class="coach-raw">${escapeHtml(advice.text)}</pre>` : ""}
    </div>
  `;
}

function coachSection(section) {
  return `
    <article class="coach-card">
      <h4>${escapeHtml(section.title)}</h4>
      <ul>
        ${section.items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </article>
  `;
}

function parseAdviceSections(text) {
  const lines = String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const sections = [];
  let current = null;

  lines.forEach(line => {
    if (line.startsWith("来源：")) return;
    const normalized = line.replace(/^#+\s*/, "");
    if (normalized.startsWith("备注：未连接真实 AI")) return;
    const isBullet = /^[-*]\s+/.test(normalized);
    if (!isBullet && normalized.length <= 24 && !normalized.includes("：")) {
      current = { title: normalized, items: [] };
      sections.push(current);
      return;
    }
    if (!current) {
      current = { title: "建议摘要", items: [] };
      sections.push(current);
    }
    current.items.push(normalized.replace(/^[-*]\s+/, ""));
  });

  return sections.filter(section => section.items.length);
}

function renderAll() {
  renderDailyCoach();
  renderSafetyStrip();
  renderTodayDashboard();
  renderWorkoutExecution();
  renderWorkoutDashboard();
  renderFocusStrip();
  renderWeeklyTargetPanel();
  renderStarterGuide();
  renderReadiness();
  renderRetentionInsights();
  renderWeeklyReview();
  renderSummary();
  renderExerciseProgress();
  renderTrends();
  renderHistory();
  renderLibrary();
  renderWorkoutExerciseOptions();
  renderAdvice();
  updateWaterStepUi();
}

function renderSafetyStrip() {
  const strip = $("safetyStrip");
  if (!strip) return;
  const daily = getDailyDraft();
  const highPain = daily.pain >= 4;
  const elevatedPain = daily.pain >= 2;
  const title = highPain ? "疼痛高，今天优先恢复" : elevatedPain ? "有疼痛信号，先保守" : "建议不是医疗诊断";
  const text = highPain
    ? "避免负重或诱发疼痛的动作；如果疼痛持续、加重或影响日常活动，建议咨询专业人士。"
    : elevatedPain
      ? "训练时避开不适部位，把强度留在可控范围；不适加重时停止相关动作。"
      : "这里的建议用于记录和训练参考，不能替代医生、康复师或其他专业人士判断。";
  strip.innerHTML = `
    <div class="safety-copy ${highPain ? "danger" : elevatedPain ? "warning" : ""}">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(text)}</p>
    </div>
  `;
}

function startOnboardingRecord() {
  const form = $("dailyForm");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  highlightOnboardingFields();
}

function viewStarterCoach() {
  $("dailyCoach").scrollIntoView({ behavior: "smooth", block: "start" });
  showToast("先看 starter 建议，保存状态后会更贴近你");
}

function highlightOnboardingFields() {
  ["sleepHours", "energy", "soreness", "pain"].forEach(id => {
    const field = $(id).closest("label") || $(id);
    field.classList.add("onboarding-highlight");
    window.setTimeout(() => field.classList.remove("onboarding-highlight"), 1800);
  });
}

function renderWorkoutExecution() {
  const panel = $("workoutExecution");
  if (!panel) return;
  const draft = getWorkoutPlanDraft();
  const isCoachSession = draft.title.startsWith("今日建议 -");
  const isRecovery = /恢复|拉伸/.test(draft.title) || /恢复|居家/.test(draft.note);
  const intent = isRecovery ? "恢复训练" : isCoachSession ? "今日建议" : draft.exercises.length ? "自由记录" : "等待开始";
  const progress = buildWorkoutProgress(draft);
  const guidance = buildExecutionGuidance(draft, progress, isRecovery);
  const summary = lastWorkoutSummary ? savedWorkoutSummary(lastWorkoutSummary) : "";

  panel.innerHTML = `
    <div class="execution-main">
      <div>
        <p class="eyebrow">Workout Plan</p>
        <h3>${escapeHtml(draft.title || "本次训练计划")}</h3>
        <p class="muted">${escapeHtml(guidance)}</p>
      </div>
      <span class="type-pill">${escapeHtml(intent)}</span>
    </div>
    <div class="execution-progress">
      <div class="progress-ring" style="--progress:${progress.percent}%">
        <strong>${progress.percent}</strong>
        <span>完成</span>
      </div>
      <div class="execution-stats">
        ${executionStat("动作", `${draft.exercises.length}`, "计划结构")}
        ${executionStat("组数", `${progress.completedSets}/${progress.plannedSets}`, "已记录/计划")}
        ${executionStat("强度", progress.avgRpe === null ? `RPE ${draft.sessionRpe}` : `RPE ${formatMetric(progress.avgRpe)}`, "组均或整体")}
        ${executionStat("时长", draft.duration === null ? "未填" : `${draft.duration} 分钟`, "预计/实际")}
      </div>
    </div>
    <div class="execution-actions">
      <button id="finishWorkoutBtn" type="button">${editingWorkoutId ? "保存修改" : "完成并保存"}</button>
      <button id="loadCoachWorkoutBtn" class="ghost-button" type="button">载入今日建议</button>
      <button id="executionAddExerciseBtn" class="ghost-button" type="button">添加动作</button>
    </div>
    ${summary}
  `;
}

function executionStat(label, value, note) {
  return `
    <article class="execution-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </article>
  `;
}

function savedWorkoutSummary(summary) {
  return `
    <div class="execution-summary">
      <strong>刚刚保存：${escapeHtml(summary.title)}</strong>
      <span>${summary.exercises} 个动作 · ${summary.sets} 组 · RPE ${summary.sessionRpe}/10</span>
      <p>${escapeHtml(summary.suggestion)}</p>
    </div>
  `;
}

function getWorkoutPlanDraft() {
  const exercises = Array.from(document.querySelectorAll(".exercise-card")).map(card => {
    const name = card.querySelector(".exercise-name").value;
    const rows = Array.from(card.querySelectorAll(".set-grid")).map(row => setFromRow(row));
    return { name, rows };
  }).filter(exercise => exercise.name);

  return {
    date: $("workoutDate").value || today(),
    title: $("workoutTitle").value.trim(),
    duration: numberOrNull($("duration").value),
    sessionRpe: Number($("sessionRpe").value),
    note: $("workoutNote").value.trim(),
    exercises
  };
}

function buildWorkoutProgress(draft) {
  const rows = draft.exercises.flatMap(exercise => exercise.rows);
  const plannedSets = rows.length;
  const completedSets = rows.filter(set => isCompletedSet(set)).length;
  const avgRpe = average(rows.map(set => set.rpe).filter(value => value !== null));
  const percent = plannedSets ? clamp(Math.round(completedSets / plannedSets * 100), 0, 100) : 0;
  return { plannedSets, completedSets, avgRpe, percent };
}

function isActualSetNote(note, defaultNote = "") {
  if (!note) return false;
  if (note === defaultNote) return false;
  return /完成|实际|做完|已做|感觉|疼|痛|轻松|困难|失败|不适/.test(note);
}

function buildExecutionGuidance(draft, progress, isRecovery) {
  if (!draft.exercises.length || progress.plannedSets === 0) return "先载入今日建议或添加第一个动作。";
  if (isRecovery) return "保持轻松，结束时应该感觉更松，不是更累。";
  if (draft.sessionRpe >= 8 || (progress.avgRpe !== null && progress.avgRpe >= 8)) return "强度偏高，后面组数先别加量，优先动作稳定。";
  if (progress.completedSets === 0) return "先完成每个动作的第一组，重量可以保守。";
  if (progress.percent >= 80) return "训练结构已经完整，可以保存并写一句备注。";
  return "继续按计划记录，目标是稳稳完成，不需要冲极限。";
}

function renderRetentionInsights() {
  const panel = $("retentionInsights");
  if (!panel) return;
  const review = buildRetentionReview();

  panel.innerHTML = `
    <div class="retention-header">
      <div>
        <p class="eyebrow">Review Center</p>
        <h3>复盘中心</h3>
        <p class="muted">${escapeHtml(review.summary)}</p>
      </div>
      <div class="retention-header-actions">
        <span class="type-pill">${escapeHtml(review.rangeLabel)}</span>
        <span class="confidence-pill ${escapeAttr(review.confidenceKey)}">${escapeHtml(review.confidenceLabel)}</span>
        <button id="exportWeeklyReportBtn" class="ghost-button" type="button">导出周报</button>
      </div>
    </div>
    <div class="retention-metrics">
      ${review.metrics.map(metric => retentionMetric(metric)).join("")}
    </div>
    <div class="retention-body">
      <section class="retention-block">
        <div class="panel-heading compact-heading">
          <div>
            <p class="eyebrow">Risk</p>
            <h4>风险提醒</h4>
          </div>
        </div>
        <div class="retention-list">
          ${review.risks.map(item => retentionItem(item, "risk")).join("")}
        </div>
      </section>
      <section class="retention-block">
        <div class="panel-heading compact-heading">
          <div>
            <p class="eyebrow">Next Week</p>
            <h4>下周行动</h4>
          </div>
        </div>
        <div class="retention-list">
          ${review.actions.map(item => retentionItem(item, "action")).join("")}
        </div>
      </section>
    </div>
  `;
}

function retentionMetric(metric) {
  return `
    <article class="retention-metric">
      <span>${escapeHtml(metric.label)}</span>
      <strong>${escapeHtml(metric.value)}</strong>
      <small>${escapeHtml(metric.note)}</small>
    </article>
  `;
}

function retentionItem(item, type) {
  return `
    <article class="retention-item ${escapeAttr(item.level || type)}">
      <span>${escapeHtml(type === "risk" ? item.levelLabel : item.index)}</span>
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.text)}</p>
      </div>
    </article>
  `;
}

function buildRetentionReview() {
  const days = getLastDays(7);
  const recentDaily = getRecent(state.dailyLogs, 7);
  const recentWorkouts = getRecent(state.workouts, 7);
  const totalSets = recentWorkouts.reduce((sum, workout) => sum + countSets(workout), 0);
  const avgSleep = average(recentDaily.map(item => item.sleepHours).filter(value => value !== null));
  const avgPain = average(recentDaily.map(item => item.pain).filter(value => value !== null && value !== undefined));
  const avgSoreness = average(recentDaily.map(item => item.soreness).filter(value => value !== null && value !== undefined));
  const avgEnergy = average(recentDaily.map(item => item.energy).filter(value => value !== null && value !== undefined));
  const hydrationDays = recentDaily.filter(item => (item.waterMl || 0) >= state.settings.waterTargetMl).length;
  const highRpeWorkouts = recentWorkouts.filter(workout => workout.sessionRpe >= 8);
  const denseHighRpe = highRpeWorkouts.some(workout => {
    const nearby = highRpeWorkouts.filter(item => dateDistanceDays(item.date, workout.date) <= 2);
    return nearby.length >= 2;
  });
  const maxPain = recentDaily.reduce((max, item) => Math.max(max, item.pain ?? 0), 0);
  const coverageScore = recentDaily.length + Math.min(2, recentWorkouts.length);
  const confidenceKey = coverageScore >= 7 ? "high" : coverageScore >= 4 ? "medium" : "low";
  const confidenceLabel = confidenceKey === "high" ? "复盘可信" : confidenceKey === "medium" ? "数据可用" : "数据偏少";
  const summary = buildRetentionSummary(recentDaily, recentWorkouts, avgSleep, avgPain, highRpeWorkouts.length, confidenceKey);

  const review = {
    rangeLabel: `${days[0]} 至 ${days.at(-1)}`,
    confidenceKey,
    confidenceLabel,
    summary,
    metrics: [
      { label: "训练", value: `${recentWorkouts.length} 次`, note: "最近 7 天" },
      { label: "组数", value: `${totalSets} 组`, note: "有效训练量" },
      { label: "睡眠", value: avgSleep === null ? "暂无" : `${formatMetric(avgSleep)}h`, note: "平均值" },
      { label: "饮水", value: `${hydrationDays}/${recentDaily.length || 7} 天`, note: `达到 ${state.settings.waterTargetMl}ml` },
      { label: "疼痛", value: avgPain === null ? "暂无" : `${formatMetric(avgPain)}/5`, note: avgSoreness === null ? "平均疼痛" : `酸痛 ${formatMetric(avgSoreness)}/5` }
    ],
    risks: buildRetentionRisks({
      recentDaily,
      recentWorkouts,
      avgSleep,
      avgPain,
      avgEnergy,
      maxPain,
      highRpeCount: highRpeWorkouts.length,
      denseHighRpe,
      confidenceKey
    }),
    actions: buildRetentionActions({
      recentDaily,
      recentWorkouts,
      avgSleep,
      avgPain,
      avgEnergy,
      highRpeCount: highRpeWorkouts.length,
      totalSets,
      weeklyTarget: state.settings.weeklyWorkoutTarget,
      trainingGoal: state.settings.trainingGoal,
      confidenceKey
    })
  };
  return review;
}

function buildRetentionSummary(dailyLogs, workouts, avgSleep, avgPain, highRpeCount, confidenceKey) {
  if (confidenceKey === "low") return "先补足 3 天状态记录和 1 次训练，复盘会更像你的真实节奏。";
  if ((avgPain ?? 0) >= 2.5) return "本周恢复风险偏高，下周更适合降低负重训练压力。";
  if (highRpeCount >= 2) return "本周高强度训练较多，下周重点是稳住动作质量，不急着加量。";
  if (avgSleep !== null && avgSleep < 6.5) return "本周睡眠偏低，训练表现可能被恢复限制。";
  if (workouts.length >= 2 && dailyLogs.length >= 4) return "本周已经形成记录节奏，可以用复盘决定下周的小调整。";
  return "本周数据开始成形，继续补齐训练和状态记录，建议会更稳定。";
}

function buildRetentionRisks(context) {
  const risks = [];
  if (context.confidenceKey === "low") {
    risks.push({
      level: "info",
      levelLabel: "资料",
      title: "数据还不足",
      text: "少于 3 天状态记录或缺少训练记录时，复盘只能给 starter 建议。"
    });
  }
  if (context.maxPain >= 4) {
    risks.push({
      level: "danger",
      levelLabel: "疼痛",
      title: "出现高疼痛信号",
      text: "本周有疼痛 4/5 以上记录，下周先避开不适动作，必要时咨询专业人士。"
    });
  } else if ((context.avgPain ?? 0) >= 2.5) {
    risks.push({
      level: "warning",
      levelLabel: "恢复",
      title: "疼痛平均值偏高",
      text: "疼痛均值接近风险区，下周建议减少负重训练压力，把动作质量放在第一位。"
    });
  }
  if (context.avgSleep !== null && context.avgSleep < 6.5) {
    risks.push({
      level: "warning",
      levelLabel: "睡眠",
      title: "恢复基础偏弱",
      text: `平均睡眠 ${formatMetric(context.avgSleep)} 小时，训练进步可能受限，下周先把睡眠拉稳。`
    });
  }
  if (context.highRpeCount >= 2) {
    risks.push({
      level: context.denseHighRpe ? "danger" : "warning",
      levelLabel: "强度",
      title: context.denseHighRpe ? "高强度过于密集" : "高 RPE 训练偏多",
      text: "本周至少 2 次 RPE 8 以上训练，下周不建议继续加重量或加总组数。"
    });
  }
  if (!context.recentWorkouts.length && context.recentDaily.length >= 3) {
    risks.push({
      level: "info",
      levelLabel: "训练",
      title: "状态有记录，训练还缺样本",
      text: "你已经开始记录身体状态，补一条训练记录后，系统能判断负荷和恢复关系。"
    });
  }
  if (!risks.length) {
    risks.push({
      level: "stable",
      levelLabel: "稳定",
      title: "没有明显红灯",
      text: "本周睡眠、疼痛和训练强度没有明显风险信号，下周可以维持当前节奏。"
    });
  }
  return risks.slice(0, 3);
}

function buildRetentionActions(context) {
  const actions = [];
  if (context.confidenceKey === "low") {
    actions.push("连续记录 3 天睡眠、饮水、精力和疼痛。");
    actions.push("完成 1 次新手全身训练，并记录至少 3 组真实数据。");
    actions.push("训练后写一句备注，标记动作是否舒服。");
    return actions.map((text, index) => retentionAction(text, index));
  }
  if ((context.avgPain ?? 0) >= 2.5) {
    actions.push("下周至少安排 1 天恢复或活动度训练，避开疼痛动作。");
  } else if (context.recentWorkouts.length >= context.weeklyTarget) {
    actions.push(`维持每周 ${context.weeklyTarget} 次训练目标，不急着增加训练日。`);
  } else if (!context.recentWorkouts.length) {
    actions.push("从 1 次全身入门训练开始，把动作、次数和 RPE 记完整。");
  } else {
    actions.push("保持当前训练节奏，先把记录完整度做稳。");
  }
  if (context.highRpeCount >= 2) {
    actions.push("下周核心动作先维持重量，目标 RPE 控制在 6 到 7。");
  } else if (context.trainingGoal === "muscle_gain" && context.totalSets >= 8) {
    actions.push("围绕同一批动作稳定完成组数，再考虑小幅增加训练量。");
  } else if (context.trainingGoal === "fat_loss") {
    actions.push("力量训练之外，补一次轻松步行或低强度有氧，保持可持续。");
  } else if (context.totalSets >= 8) {
    actions.push("选择 1 个核心动作重复练习，观察重量或次数是否更稳定。");
  } else {
    actions.push("每次训练至少完成 3 到 6 组有效记录，让趋势更可靠。");
  }
  if (context.avgSleep !== null && context.avgSleep < 6.5) {
    actions.push("睡眠低于 6.5 小时时，把当天建议改成轻量练或恢复日。");
  } else if ((context.avgEnergy ?? 0) < 3) {
    actions.push("精力偏低时减少冲强度，把训练目标改成完成和技术质量。");
  } else {
    actions.push("训练后补一句身体感受，帮助下周判断是否该推进。");
  }
  return actions.slice(0, 3).map((text, index) => retentionAction(text, index));
}

function retentionAction(text, index) {
  return {
    index: String(index + 1).padStart(2, "0"),
    title: index === 0 ? "训练安排" : index === 1 ? "强度控制" : "记录习惯",
    text
  };
}

function buildWeeklyReportText(review = buildRetentionReview()) {
  return [
    `# 日常与健身记录周报`,
    "",
    `范围：${review.rangeLabel}`,
    `可信度：${review.confidenceLabel}`,
    "",
    "## 本周摘要",
    ...review.metrics.map(metric => `- ${metric.label}：${metric.value}（${metric.note}）`),
    "",
    "## 风险提醒",
    ...review.risks.map(item => `- ${item.title}：${item.text}`),
    "",
    "## 下周行动",
    ...review.actions.map(item => `- ${item.text}`),
    "",
    "## 隐私",
    "这份周报由本机记录生成，不包含完整原始历史。请继续用 JSON 导出做真正备份。",
    "",
    "## 安全说明",
    "本应用建议只用于训练和恢复记录参考，不构成医疗诊断。疼痛持续、加重或影响日常活动时，请咨询专业人士。"
  ].join("\n");
}

function renderWeeklyReview() {
  const review = buildWeeklyReview();
  $("weeklyReview").innerHTML = `
    <div class="weekly-review-main">
      <div>
        <p class="eyebrow">Weekly Review</p>
        <h3>本周回顾</h3>
        <p class="muted">${escapeHtml(review.summary)}</p>
      </div>
      <span class="type-pill">${escapeHtml(review.coverage)}</span>
    </div>
    <div class="weekly-review-grid">
      ${weeklyMetric("训练", review.metrics.workouts, "本周次数")}
      ${weeklyMetric("训练量", review.metrics.sets, "总组数")}
      ${weeklyMetric("睡眠", review.metrics.sleep, "平均值")}
      ${weeklyMetric("饮水", review.metrics.water, "达标天数")}
    </div>
    <div class="weekly-actions">
      ${review.actions.map((action, index) => `
        <article class="weekly-action">
          <span>${String(index + 1).padStart(2, "0")}</span>
          <p>${escapeHtml(action)}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function weeklyMetric(label, value, note) {
  return `
    <article class="weekly-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </article>
  `;
}

function buildWeeklyReview() {
  const recentDaily = getRecent(state.dailyLogs, 7);
  const recentWorkouts = getRecent(state.workouts, 7);
  const totalSets = recentWorkouts.reduce((sum, workout) => sum + countSets(workout), 0);
  const avgSleep = average(recentDaily.map(item => item.sleepHours).filter(value => value !== null));
  const avgEnergy = average(recentDaily.map(item => item.energy));
  const avgPain = average(recentDaily.map(item => item.pain));
  const waterDays = recentDaily.filter(item => (item.waterMl || 0) >= 1800).length;
  const highRpeCount = recentWorkouts.filter(item => item.sessionRpe >= 8).length;
  const coverage = recentDaily.length || recentWorkouts.length
    ? `${recentDaily.length} 天状态 · ${recentWorkouts.length} 次训练`
    : "等待记录";
  const summary = buildWeeklySummary(recentDaily, recentWorkouts, avgSleep, avgEnergy, avgPain, highRpeCount);

  return {
    coverage,
    summary,
    metrics: {
      workouts: `${recentWorkouts.length} 次`,
      sets: `${totalSets} 组`,
      sleep: avgSleep === null ? "暂无" : `${avgSleep.toFixed(1)}h`,
      water: `${waterDays}/${recentDaily.length || 7} 天`
    },
    actions: buildWeeklyActions(recentDaily, recentWorkouts, avgSleep, avgEnergy, avgPain, highRpeCount)
  };
}

function buildWeeklySummary(dailyLogs, workouts, avgSleep, avgEnergy, avgPain, highRpeCount) {
  if (!dailyLogs.length && !workouts.length) {
    return "记录 3 天生活状态和 1 次训练后，这里会生成更准确的周回顾。";
  }
  if ((avgPain ?? 0) >= 2) return "本周疼痛信号偏高，下周更适合把恢复和动作质量放在第一位。";
  if (highRpeCount >= 2) return "本周高强度训练较多，下周建议控制推进幅度，避免连续硬顶。";
  if (avgSleep !== null && avgSleep < 6.5) return "本周睡眠偏少，训练表现可能受恢复限制，优先把睡眠拉回稳定区间。";
  if (workouts.length >= 3 && (avgEnergy ?? 0) >= 3.5) return "本周训练节奏和主观状态都不错，下周可以选择一个核心动作小幅推进。";
  return "本周数据正在形成节奏，继续保持记录，下周建议会更贴近你的真实状态。";
}

function buildWeeklyActions(dailyLogs, workouts, avgSleep, avgEnergy, avgPain, highRpeCount) {
  if (!dailyLogs.length && !workouts.length) {
    return [
      "先连续记录 3 天睡眠、饮水、精力和疼痛。",
      "完成一次包含重量、次数和 RPE 的训练记录。",
      "记录后在洞察页生成第一条建议。"
    ];
  }

  const actions = [];
  if (avgSleep !== null && avgSleep < 6.5) {
    actions.push("下周先把睡眠稳定到 6.5 小时以上，再考虑加训练量。");
  } else {
    actions.push("保持睡眠和饮水记录，让恢复判断继续变准。");
  }
  if (highRpeCount >= 2) {
    actions.push("减少连续高 RPE 训练，至少安排一次技术或恢复日。");
  } else if (workouts.length) {
    actions.push("选择一个核心动作小幅加重或多做一组。");
  } else {
    actions.push("补一条训练记录，让系统开始识别你的训练负荷。");
  }
  if ((avgPain ?? 0) >= 2) {
    actions.push("疼痛持续时避开不适部位，必要时咨询专业人士。");
  } else if ((avgEnergy ?? 0) < 3) {
    actions.push("精力偏低时先维持训练质量，不急着增加总量。");
  } else {
    actions.push("训练后写一句备注，记录技术感受或不适部位。");
  }
  return actions;
}

function renderStarterGuide() {
  const guide = $("starterGuide");
  if (!guide) return;
  const hasStarted = state.dailyLogs.length || state.workouts.length;
  if (hasStarted) {
    guide.hidden = true;
    guide.innerHTML = "";
    return;
  }

  guide.hidden = false;
  const steps = buildOnboardingSteps();
  guide.innerHTML = `
    <div class="starter-copy onboarding-copy">
      <p class="eyebrow">Start</p>
      <h2>先记录 4 个状态，我会给你今天怎么练的建议。</h2>
      <p class="muted">不知道怎么填也没关系，先按现在的感觉。疼痛高时，我会优先建议恢复。</p>
      <div class="onboarding-actions">
        <button id="startOnboardingRecordBtn" type="button">开始 60 秒记录</button>
        <button id="viewStarterCoachBtn" class="ghost-button" type="button">直接看今日建议</button>
      </div>
      <p class="privacy-note">数据先保存在本机，可随时导出。</p>
    </div>
    <div class="onboarding-checklist">
      ${steps.map(onboardingStep).join("")}
    </div>
  `;
}

function buildOnboardingSteps() {
  const daily = getDailyDraft();
  const savedToday = state.dailyLogs.some(item => item.date === daily.date);
  return [
    {
      key: "sleep",
      title: "睡眠",
      text: daily.sleepHours === null ? "填昨晚大概睡了多久" : `${formatMetric(daily.sleepHours)} 小时`,
      done: daily.sleepHours !== null
    },
    {
      key: "energy",
      title: "精力",
      text: `现在是 ${daily.energy}/5`,
      done: savedToday || onboardingTouched.energy
    },
    {
      key: "soreness",
      title: "酸痛",
      text: `现在是 ${daily.soreness}/5`,
      done: savedToday || onboardingTouched.soreness
    },
    {
      key: "pain",
      title: "疼痛",
      text: `现在是 ${daily.pain}/5`,
      done: savedToday || onboardingTouched.pain
    }
  ];
}

function onboardingStep(step) {
  return `
    <div class="onboarding-step ${step.done ? "done" : ""}">
      <span>${step.done ? "✓" : ""}</span>
      <div>
        <strong>${escapeHtml(step.title)}</strong>
        <small>${escapeHtml(step.text)}</small>
      </div>
    </div>
  `;
}

function renderDailyCoach() {
  const coach = $("dailyCoach");
  if (!coach) return;
  const recommendation = buildDailyCoachRecommendation();
  const reasonList = recommendation.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("");

  coach.innerHTML = `
    <div class="daily-coach-main">
      <div>
        <p class="eyebrow">Daily Coach</p>
        <h2>今日建议</h2>
        <p class="muted">${escapeHtml(recommendation.summary)}</p>
      </div>
      <span class="coach-status ${escapeAttr(recommendation.statusKey)}">${escapeHtml(recommendation.statusLabel)}</span>
    </div>
    <div class="daily-coach-body">
      <article class="coach-decision">
        <span>${escapeHtml(recommendation.template.environment)} · ${escapeHtml(recommendation.durationText)}</span>
        <strong>${escapeHtml(recommendation.template.name)}</strong>
        <small>${escapeHtml(recommendation.intensityText)}</small>
      </article>
      <div class="coach-reasons">
        <h3>为什么这样建议</h3>
        <ul>${reasonList}</ul>
        ${recommendation.caution ? `<p class="coach-caution">${escapeHtml(recommendation.caution)}</p>` : ""}
      </div>
      <div class="coach-actions">
        <button id="startCoachWorkoutBtn" type="button">开始今天训练</button>
        <button class="ghost-button" type="button" data-target-tab="today">只记录状态</button>
      </div>
    </div>
  `;
}

function buildDailyCoachRecommendation() {
  const daily = getDailyDraft();
  const todayLog = state.dailyLogs.find(item => item.date === daily.date);
  const hasBodyState = Boolean(todayLog) || daily.sleepHours !== null || daily.waterMl !== null;
  const recentWorkouts = getRecent(state.workouts, 7);
  const hardWorkouts = recentWorkouts.filter(workout => workout.sessionRpe >= 8);
  const hardLast3 = recentWorkouts.filter(workout => daysBetween(workout.date, today()) <= 2 && workout.sessionRpe >= 8);
  const latestWorkout = state.workouts.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  const daysSinceLastWorkout = latestWorkout ? daysBetween(latestWorkout.date, today()) : null;
  const sleep = daily.sleepHours;
  const energy = daily.energy;
  const soreness = daily.soreness;
  const pain = daily.pain;
  const water = daily.waterMl ?? 0;
  const waterTarget = state.settings.waterTargetMl;
  const reasons = [];
  let statusKey = "normal";
  let statusLabel = "正常练";
  let template = pickBeginnerTemplate("normal", latestWorkout);
  let summary = "今天适合做一次稳定的新手训练，重点是动作质量和完成感。";
  let intensityText = "目标 RPE 6 左右，保留 3 次余力。";
  let caution = "";

  if (!hasBodyState) {
    reasons.push("还没有今天的睡眠、饮水或状态记录。");
    reasons.push("先用温和全身训练建立第一条节奏。");
    reasons.push("记录越完整，后续建议会越贴近你。");
    return {
      statusKey: "starter",
      statusLabel: "先建立记录",
      template,
      summary: "先记录今天的睡眠、精力和酸痛，我会给你今天的训练建议。",
      reasons,
      caution: "",
      intensityText,
      durationText: `${template.duration} 分钟`
    };
  }

  if (pain >= 4) {
    statusKey = "recovery";
    statusLabel = "恢复日";
    template = pickBeginnerTemplate("recovery");
    summary = "今天疼痛信号偏高，先不要硬练，把目标放在恢复和活动度。";
    intensityText = "轻松活动，不做负重冲刺。";
    caution = "如果疼痛持续或加重，建议咨询专业人士。";
    reasons.push(`疼痛 ${pain}/5，安全优先级高于训练量。`);
  } else if ((sleep !== null && sleep < 6 && soreness >= 4) || hardLast3.length >= 2 || (state.settings.conservativeMode && (sleep !== null && sleep < 6.5 || soreness >= 4))) {
    statusKey = "light";
    statusLabel = "轻量练";
    template = pickBeginnerTemplate("light", latestWorkout);
    summary = "今天适合保留训练习惯，但不要追求加量。";
    intensityText = "目标 RPE 5-6，动作慢一点。";
    if (sleep !== null && sleep < 6) reasons.push(`睡眠 ${formatMetric(sleep)}h，恢复基础偏弱。`);
    if (soreness >= 4) reasons.push(`酸痛 ${soreness}/5，肌肉还在恢复中。`);
    if (hardLast3.length >= 2) reasons.push("近 3 天高强度训练偏密集。");
    if (state.settings.conservativeMode) reasons.push("你开启了保守建议模式。");
  } else if (energy >= 4 && pain <= 1 && (daysSinceLastWorkout === null || daysSinceLastWorkout >= 2)) {
    statusKey = "normal";
    statusLabel = "正常练";
    template = pickBeginnerTemplate("normal", latestWorkout);
    summary = "今天状态不错，适合做一次完整的新手训练。";
    intensityText = "目标 RPE 6-7，不需要冲极限。";
    reasons.push(`精力 ${energy}/5，主观状态可承受训练。`);
    reasons.push(daysSinceLastWorkout === null ? "还没有训练记录，适合从全身入门开始。" : `距离上次训练 ${daysSinceLastWorkout} 天，恢复时间足够。`);
  } else {
    statusKey = "light";
    statusLabel = "轻量练";
    template = pickBeginnerTemplate("light", latestWorkout);
    summary = "今天建议稳一点，用中低强度训练保持节奏。";
    intensityText = "目标 RPE 5-6，结束时应该还有余力。";
    reasons.push("当前状态没有明显红灯，但也不需要硬推强度。");
  }

  if (water < waterTarget * 0.75) reasons.push(`饮水 ${water} ml 低于目标 ${waterTarget} ml，训练前先补一次水。`);
  if (state.settings.trainingGoal !== "general") reasons.push(`当前目标：${goalLabel()}，建议会优先考虑这个方向。`);
  if (state.settings.preferredEnvironment !== "gym") reasons.push(`训练环境偏好：${environmentLabel()}。`);
  if (!recentWorkouts.length) reasons.push("还没有训练历史，系统先推荐新手友好的基础模板。");
  if (hardWorkouts.length && statusKey !== "recovery") reasons.push(`最近 7 天有 ${hardWorkouts.length} 次高 RPE 训练，今天不建议冲极限。`);
  if (!reasons.length) reasons.push("睡眠、疼痛和训练间隔没有明显风险信号。");

  return {
    statusKey,
    statusLabel,
    template,
    summary,
    reasons: reasons.slice(0, 3),
    caution,
    intensityText,
    durationText: `${template.duration} 分钟`
  };
}

function pickBeginnerTemplate(mode, latestWorkout = null) {
  if (mode === "recovery") return beginnerTemplates.find(item => item.id === "beginner_recovery");
  if (mode === "light") return beginnerTemplates.find(item => item.id === "beginner_full_body");
  const latestTitle = `${latestWorkout?.title || ""} ${latestWorkout?.exercises?.map(item => item.name).join(" ") || ""}`;
  if (/上肢|卧推|肩推|下拉|划船/.test(latestTitle)) {
    return beginnerTemplates.find(item => item.id === "beginner_lower");
  }
  if (/下肢|腿|深蹲|硬拉|臀桥/.test(latestTitle)) {
    return beginnerTemplates.find(item => item.id === "beginner_upper");
  }
  return beginnerTemplates.find(item => item.id === "beginner_full_body");
}

function renderWorkoutDashboard() {
  const dashboard = $("workoutDashboard");
  if (!dashboard) return;

  const draft = getWorkoutDraft();
  const setCount = draft.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
  const totalVolume = draft.exercises.reduce((sum, exercise) => (
    sum + exercise.sets.reduce((inner, set) => inner + ((set.weight || 0) * (set.reps || 0)), 0)
  ), 0);
  const avgRpe = average(draft.exercises.flatMap(exercise => exercise.sets.map(set => set.rpe).filter(value => value !== null)));
  const intensity = draft.sessionRpe >= 8 ? "高强度" : draft.sessionRpe >= 6 ? "常规训练" : "技术恢复";
  const action = buildWorkoutAction(draft, setCount, totalVolume, avgRpe);

  dashboard.innerHTML = `
    <div class="workout-brief">
      <div>
        <p class="eyebrow">Session</p>
        <h3>${escapeHtml(draft.title || "未命名训练")}</h3>
        <p class="muted">${escapeHtml(action)}</p>
      </div>
      <div class="workout-rpe">
        <strong>${draft.sessionRpe}</strong>
        <span>RPE</span>
      </div>
    </div>
    <div class="workout-metrics">
      ${workoutMetric("动作", `${draft.exercises.length}`, "当前结构")}
      ${workoutMetric("有效组", `${setCount}`, setCount ? "可保存训练" : "等待组数据")}
      ${workoutMetric("训练量", formatVolume(totalVolume), "重量 x 次数")}
      ${workoutMetric("强度", intensity, avgRpe === null ? "等待组 RPE" : `组均 RPE ${formatMetric(avgRpe)}`)}
    </div>
  `;
}

function workoutMetric(label, value, note) {
  return `
    <article class="workout-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </article>
  `;
}

function getWorkoutDraft() {
  return {
    date: $("workoutDate").value || today(),
    title: $("workoutTitle").value.trim(),
    duration: numberOrNull($("duration").value),
    sessionRpe: Number($("sessionRpe").value),
    note: $("workoutNote").value.trim(),
    exercises: collectWorkoutExercises()
  };
}

function buildWorkoutAction(draft, setCount, totalVolume, avgRpe) {
  if (!draft.exercises.length) return "先添加一个动作，记录重量、次数和主观难度。";
  if (setCount < 3) return "结构已经开始成形，再补几组数据会更适合保存。";
  if (draft.sessionRpe >= 8 || (avgRpe !== null && avgRpe >= 8)) return "强度偏高，保存前建议写下状态和不适部位。";
  if (totalVolume > 0) return "训练结构清晰，完成后保存即可进入趋势分析。";
  return "动作已选择，补上重量和次数后会生成训练量。";
}

function formatVolume(value) {
  if (!value) return "0 kg";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}t`;
  return `${Math.round(value)} kg`;
}

function renderTodayDashboard() {
  const dashboard = $("todayDashboard");
  if (!dashboard) return;

  const daily = getDailyDraft();
  const readiness = calculateReadiness(daily);
  const latestWorkout = state.workouts.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  const water = daily.waterMl ?? 0;
  const waterTarget = state.settings.waterTargetMl;
  const waterRatio = clamp(Math.round(water / waterTarget * 100), 0, 100);
  const recoveryLabel = daily.sleepHours === null
    ? "等待睡眠记录"
    : daily.sleepHours >= 7
      ? "恢复基础不错"
      : "恢复需要补一点";
  const action = buildTodayAction(readiness, daily, latestWorkout);

  dashboard.innerHTML = `
    <div class="today-brief">
      <div>
        <p class="eyebrow">Today</p>
        <h3>${escapeHtml(readiness.label)}</h3>
        <p class="muted">${escapeHtml(action)}</p>
      </div>
      <div class="today-score" style="--score:${readiness.score}%">
        <strong>${readiness.score}</strong>
        <span>状态</span>
      </div>
    </div>
    <div class="today-metrics">
      ${todayMetric("饮水", `${water} ml`, `${waterRatio}% / ${waterTarget}ml`, waterRatio)}
      ${todayMetric("睡眠", daily.sleepHours === null ? "未填" : `${formatMetric(daily.sleepHours)}h`, recoveryLabel)}
      ${todayMetric("精力", `${daily.energy}/5`, daily.energy >= 4 ? "可推进" : "先稳住")}
      ${todayMetric("训练", latestWorkout ? latestWorkout.title : "暂无", latestWorkout ? `${latestWorkout.date} · ${countSets(latestWorkout)} 组` : "记录后生成负荷")}
    </div>
  `;
}

function todayMetric(label, value, note, progress = null) {
  return `
    <article class="today-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
      ${progress === null ? "" : `<div class="mini-progress" aria-hidden="true"><span style="--progress:${progress}%"></span></div>`}
    </article>
  `;
}

function buildWeeklyTargetProgress() {
  const days = getLastDays(7);
  const target = Math.max(1, state.settings.weeklyWorkoutTarget || defaultSettings.weeklyWorkoutTarget);
  const recentWorkouts = getRecent(state.workouts, 7).slice().sort((a, b) => b.date.localeCompare(a.date));
  const completed = recentWorkouts.length;
  const remaining = Math.max(0, target - completed);
  const percent = clamp(Math.round(completed / target * 100), 0, 100);
  const totalSets = recentWorkouts.reduce((sum, workout) => sum + countSets(workout), 0);
  const latestWorkout = recentWorkouts[0] || null;
  const daily = getDailyDraft();
  const highPain = (daily.pain ?? 0) >= 4;
  const elevatedPain = (daily.pain ?? 0) >= 2;
  const status = completed >= target ? "已达标" : completed > 0 ? "推进中" : "待启动";
  const summary = completed >= target
    ? "本周训练目标已经达成，接下来把恢复、动作质量和记录完整度稳住。"
    : completed === 0
      ? "先完成一次低门槛训练，让本周目标进入执行状态。"
      : `还差 ${remaining} 次达到本周目标，下一次训练可以选择今日建议模板。`;
  const nextAction = highPain
    ? "今天疼痛较高，先记录状态并以恢复为主"
    : elevatedPain
      ? "避开不适部位，做一次保守训练或恢复记录"
      : remaining === 0
        ? "保留 1 天恢复窗口，必要时只做轻量活动"
        : "开始今日建议，完成后保存为本周进度";
  const cadence = latestWorkout
    ? `距离上次训练 ${daysBetween(latestWorkout.date, today())} 天`
    : "本周还没有训练";

  return {
    days,
    target,
    completed,
    remaining,
    percent,
    totalSets,
    latestWorkout,
    status,
    summary,
    nextAction,
    cadence
  };
}

function getCurrentTimeText(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function shouldRunReminder(reminderTime, now = new Date()) {
  return getCurrentTimeText(now) >= reminderTime;
}

function startReminderScheduler() {
  if (reminderTimer) window.clearInterval(reminderTimer);
  checkReminderSchedule();
  reminderTimer = window.setInterval(checkReminderSchedule, 60000);
}

function checkReminderSchedule(now = new Date()) {
  if (getNotificationPermission() !== "granted") {
    renderReminderStatus();
    return [];
  }

  const sent = [];
  const todayText = formatLocalDate(now);
  const hasDailyToday = state.dailyLogs.some(item => item.date === todayText);
  const hasWorkoutToday = state.workouts.some(item => item.date === todayText);
  const weeklyTarget = buildWeeklyTargetProgress();

  if (
    state.settings.dailyReminderEnabled &&
    !hasDailyToday &&
    state.settings.lastDailyReminderDate !== todayText &&
    shouldRunReminder(state.settings.dailyReminderTime, now)
  ) {
    deliverReminderNotification(
      "今天还没有记录状态",
      "花 60 秒补一下睡眠、饮水、精力和疼痛，今晚的建议会更准。",
      "daily-record"
    );
    state.settings.lastDailyReminderDate = todayText;
    sent.push("daily");
  }

  if (
    state.settings.workoutReminderEnabled &&
    !hasWorkoutToday &&
    weeklyTarget.remaining > 0 &&
    state.settings.lastWorkoutReminderDate !== todayText &&
    shouldRunReminder(state.settings.workoutReminderTime, now)
  ) {
    deliverReminderNotification(
      "本周训练目标还差一点",
      `本周还差 ${weeklyTarget.remaining} 次训练。状态允许的话，可以从今日建议开始。`,
      "weekly-workout"
    );
    state.settings.lastWorkoutReminderDate = todayText;
    sent.push("workout");
  }

  if (sent.length) {
    persistState();
    renderReminderStatus();
  }
  return sent;
}

function deliverReminderNotification(title, body, tag) {
  if (Array.isArray(window.__testNotifications)) {
    window.__testNotifications.push({ title, body, tag });
    return;
  }
  const options = {
    body,
    tag,
    icon: "/app-icon.svg",
    badge: "/app-icon.svg"
  };
  navigator.serviceWorker?.ready
    ?.then(registration => registration.showNotification(title, options))
    .catch(() => {
      if ("Notification" in window) new Notification(title, options);
    });
}

function renderWeeklyTargetPanel() {
  const panel = $("weeklyTargetPanel");
  if (!panel) return;
  const progress = buildWeeklyTargetProgress();
  const rangeLabel = `${progress.days[0].slice(5)} - ${progress.days.at(-1).slice(5)}`;
  const remainingLabel = progress.remaining === 0 ? "目标完成" : `还差 ${progress.remaining} 次`;
  panel.innerHTML = `
    <div class="weekly-target-main">
      <div>
        <p class="eyebrow">Weekly target</p>
        <h3>本周已完成 ${progress.completed}/${progress.target} 次训练</h3>
        <p class="muted">${escapeHtml(progress.summary)}</p>
      </div>
      <div class="weekly-target-score" style="--score:${progress.percent}%">
        <strong>${progress.percent}%</strong>
        <span>${escapeHtml(progress.status)}</span>
      </div>
    </div>
    <div class="weekly-target-meter" aria-label="本周训练目标进度">
      <span style="--progress:${progress.percent}%"></span>
    </div>
    <div class="weekly-target-grid">
      ${weeklyTargetMetric("周期", rangeLabel, remainingLabel)}
      ${weeklyTargetMetric("训练组数", `${progress.totalSets} 组`, progress.latestWorkout ? progress.latestWorkout.title : "保存训练后更新")}
      ${weeklyTargetMetric("训练间隔", progress.cadence, progress.latestWorkout ? progress.latestWorkout.date : "等待第一次训练")}
      ${weeklyTargetMetric("下一步", progress.nextAction, progress.remaining === 0 ? "恢复优先" : "可执行")}
    </div>
    <div class="weekly-target-actions">
      <button class="btn primary" type="button" id="startWeeklyTargetWorkoutBtn">开始今日建议</button>
      <button class="btn ghost" type="button" id="openWorkoutFromWeeklyBtn">去记录训练</button>
    </div>
  `;
}

function weeklyTargetMetric(label, value, note) {
  return `
    <article class="weekly-target-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </article>
  `;
}

function getDailyDraft() {
  return {
    id: `daily_${$("dailyDate").value || today()}`,
    date: $("dailyDate").value || today(),
    sleepHours: numberOrNull($("sleepHours").value),
    waterMl: numberOrNull($("waterMl").value),
    mood: Number($("mood").value),
    energy: Number($("energy").value),
    soreness: Number($("soreness").value),
    pain: Number($("pain").value),
    habits: {
      workout: $("habitWorkout").checked,
      stretch: $("habitStretch").checked,
      study: $("habitStudy").checked,
      earlySleep: $("habitEarlySleep").checked
    },
    note: $("dailyNote").value.trim()
  };
}

function buildTodayAction(readiness, daily, latestWorkout) {
  if ((daily.pain ?? 0) >= 2) return "今天先避开不适部位，把训练目标放在技术质量和恢复上。";
  if ((daily.sleepHours ?? 8) < 6.5) return "睡眠偏少，适合降低强度，用一次稳定记录保住节奏。";
  if ((daily.waterMl ?? 0) < state.settings.waterTargetMl * 0.75) return "饮水还偏低，先补一次水，再决定今天的训练强度。";
  if (readiness.score >= 82) return "状态很好，可以选择一个核心动作小幅加重或多做一组。";
  if (latestWorkout) return "维持计划即可，训练后补充备注会让建议更准确。";
  return "先记录一次训练或生活状态，系统会开始形成你的个人节奏。";
}

function renderReadiness() {
  const readiness = calculateReadiness();
  const scoreStyle = `--score:${readiness.score}%`;
  $("readinessPanel").innerHTML = `
    <div class="readiness-main">
      <div>
        <p class="eyebrow">Readiness</p>
        <h3>今日状态评分</h3>
        <p class="muted">${escapeHtml(readiness.detail)}</p>
      </div>
      <div class="readiness-score" style="${scoreStyle}">
        <strong>${readiness.score}</strong>
        <span>${escapeHtml(readiness.label)}</span>
      </div>
    </div>
    <div class="readiness-factors">
      ${readiness.factors.map(factor => readinessFactor(factor)).join("")}
    </div>
  `;
}

function readinessFactor(factor) {
  return `
    <article class="readiness-factor">
      <div>
        <span>${escapeHtml(factor.label)}</span>
        <strong>${escapeHtml(factor.value)}</strong>
      </div>
      <small>${escapeHtml(factor.note)}</small>
    </article>
  `;
}

function renderTrends() {
  const days = getLastDays(7);
  const dailyByDate = new Map(state.dailyLogs.map(log => [log.date, log]));
  const workoutsByDate = state.workouts.reduce((map, workout) => {
    map.set(workout.date, (map.get(workout.date) || 0) + countSets(workout));
    return map;
  }, new Map());

  const sleep = days.map(date => dailyByDate.get(date)?.sleepHours ?? null);
  const energy = days.map(date => dailyByDate.get(date)?.energy ?? null);
  const pain = days.map(date => dailyByDate.get(date)?.pain ?? null);
  const volume = days.map(date => workoutsByDate.get(date) || 0);

  $("trendGrid").innerHTML = [
    trendCard("睡眠", sleep, "h", 8),
    trendCard("精力", energy, "/5", 5),
    trendCard("训练组数", volume, "组", Math.max(8, ...volume)),
    trendCard("疼痛", pain, "/5", 5, true)
  ].join("");
}

function trendCard(label, values, suffix, maxValue, inverse = false) {
  const valid = values.filter(value => value !== null && value !== undefined);
  const latest = valid.length ? valid.at(-1) : null;
  const averageValue = average(valid);
  return `
    <article class="trend-card">
      <header>
        <span>${escapeHtml(label)}</span>
        <strong>${latest === null ? "暂无" : `${formatMetric(latest)}${escapeHtml(suffix)}`}</strong>
      </header>
      <div class="trend-bars" aria-hidden="true">
        ${values.map(value => trendBar(value, maxValue, inverse)).join("")}
      </div>
      <small>${averageValue === null ? "等待更多记录" : `均值 ${formatMetric(averageValue)}${escapeHtml(suffix)}`}</small>
    </article>
  `;
}

function trendBar(value, maxValue, inverse) {
  if (value === null || value === undefined) {
    return `<span class="trend-bar empty"></span>`;
  }
  const ratio = Math.max(0.08, Math.min(1, Number(value) / maxValue));
  const className = inverse && Number(value) >= 2 ? "trend-bar warning" : "trend-bar";
  return `<span class="${className}" style="--bar:${Math.round(ratio * 100)}%"></span>`;
}

function formatMetric(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1);
}

function renderFocusStrip() {
  const daily = state.dailyLogs.find(item => item.date === today());
  const latestWorkout = state.workouts.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  const readiness = calculateReadiness();
  const weeklyTarget = buildWeeklyTargetProgress();
  const water = daily?.waterMl ?? 0;
  const waterTarget = state.settings.waterTargetMl;
  const workoutText = latestWorkout ? `${latestWorkout.date} · ${latestWorkout.title}` : "暂无训练";

  $("focusStrip").innerHTML = [
    focusCard("今日饮水", `${water} ml`, water >= waterTarget * 0.75 ? "接近目标" : "偏低", "today"),
    focusCard("最近训练", workoutText, latestWorkout ? `${countSets(latestWorkout)} 组` : "等待记录", "workout"),
    focusCard("状态评分", `${readiness.score}/100`, readiness.label, "insights"),
    focusCard("本周目标", `${weeklyTarget.completed}/${weeklyTarget.target} 次`, weeklyTarget.remaining ? `还差 ${weeklyTarget.remaining} 次` : "目标完成", "today")
  ].join("");
}

function focusCard(label, value, meta, targetTab) {
  return `
    <button class="focus-card" type="button" data-target-tab="${escapeAttr(targetTab)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(meta)}</small>
    </button>
  `;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, item) => sum + Number(item), 0) / values.length;
}

function calculateReadiness(dailyOverride = null) {
  const latestDaily = dailyOverride || state.dailyLogs
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const recentWorkouts = getRecent(state.workouts, 7);
  const recentRpe = average(recentWorkouts.map(item => item.sessionRpe).filter(value => value !== null && value !== undefined));
  const recentSets = recentWorkouts.reduce((sum, workout) => sum + countSets(workout), 0);

  let score = 70;
  const sleepHours = latestDaily?.sleepHours ?? null;
  const energy = latestDaily?.energy ?? null;
  const soreness = latestDaily?.soreness ?? null;
  const pain = latestDaily?.pain ?? null;

  if (sleepHours === null) score -= 4;
  else if (sleepHours >= 7.5) score += 10;
  else if (sleepHours >= 6.5) score += 4;
  else if (sleepHours >= 5.5) score -= 8;
  else score -= 15;

  if (energy === null) score -= 3;
  else score += (energy - 3) * 6;

  if (soreness !== null) score -= Math.max(0, soreness - 2) * 5;
  if (pain !== null) score -= pain * 8;

  if (recentRpe !== null && recentRpe >= 8) score -= 6;
  if (recentSets >= 36) score -= 5;
  if (recentWorkouts.length === 0) score -= 2;

  score = clamp(Math.round(score), 0, 100);
  const label = score >= 82 ? "适合推进" : score >= 66 ? "稳态训练" : score >= 48 ? "保守训练" : "优先恢复";
  const detail = latestDaily
    ? buildReadinessDetail(score, latestDaily, recentWorkouts)
    : "还没有生活状态记录，先填一次睡眠、精力和疼痛，评分会立刻更准确。";

  return {
    score,
    label,
    detail,
    factors: [
      {
        label: "睡眠",
        value: sleepHours === null ? "未填" : `${formatMetric(sleepHours)}h`,
        note: sleepHours === null ? "缺少恢复基线" : sleepHours >= 7 ? "恢复基础较好" : "建议优先补觉"
      },
      {
        label: "精力",
        value: energy === null ? "未填" : `${energy}/5`,
        note: energy === null ? "等待记录" : energy >= 4 ? "可承受训练刺激" : "降低推进幅度"
      },
      {
        label: "疼痛",
        value: pain === null ? "未填" : `${pain}/5`,
        note: pain === null ? "等待记录" : pain >= 2 ? "避开不适部位" : "风险较低"
      },
      {
        label: "7日负荷",
        value: `${recentSets}组`,
        note: recentRpe === null ? "还缺训练强度" : `平均 RPE ${formatMetric(recentRpe)}`
      }
    ]
  };
}

function buildReadinessDetail(score, daily, recentWorkouts) {
  if (score >= 82) return "恢复与主观状态都不错，今天可以选择一个核心动作小幅推进。";
  if ((daily.pain ?? 0) >= 2) return "疼痛分数偏高，建议减少高强度动作，优先做技术、活动度或恢复。";
  if ((daily.sleepHours ?? 8) < 6.5) return "睡眠偏少，今天更适合维持训练质量，避免硬顶强度。";
  if (recentWorkouts.length >= 4) return "最近训练频率较高，今天适合控制总组数，给恢复留空间。";
  if (score >= 66) return "状态整体稳定，可以按计划训练，但把 RPE 留在可控区间。";
  return "身体信号不够理想，今天适合保守一点，用记录换取明天更清楚的判断。";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getRecent(items, days) {
  const start = new Date();
  start.setDate(start.getDate() - days + 1);
  const startText = formatLocalDate(start);
  return items.filter(item => item.date >= startText);
}

function daysBetween(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);
  return Math.max(0, Math.round((to - from) / 86400000));
}

function dateDistanceDays(firstDate, secondDate) {
  const first = new Date(`${firstDate}T00:00:00`);
  const second = new Date(`${secondDate}T00:00:00`);
  return Math.abs(Math.round((second - first) / 86400000));
}

function getLastDays(count) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (count - index - 1));
    return formatLocalDate(date);
  });
}

function countSets(workout) {
  return workout.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
}

function buildAdvicePayload() {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dailyLogs: state.dailyLogs.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14).map(log => ({
      date: log.date,
      sleepHours: log.sleepHours,
      waterMl: log.waterMl,
      mood: log.mood,
      energy: log.energy,
      soreness: log.soreness,
      pain: log.pain,
      note: log.note
    })),
    workouts: state.workouts.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).map(workout => ({
      date: workout.date,
      title: workout.title,
      duration: workout.duration,
      sessionRpe: workout.sessionRpe,
      note: workout.note,
      exercises: workout.exercises.map(exercise => ({
        name: exercise.name,
        sets: exercise.sets.map(set => ({ weight: set.weight, reps: set.reps, rpe: set.rpe, note: set.note }))
      }))
    })),
    settings: {
      trainingGoal: goalLabel(),
      preferredEnvironment: environmentLabel(),
      weeklyWorkoutTarget: state.settings.weeklyWorkoutTarget,
      waterTargetMl: state.settings.waterTargetMl,
      conservativeMode: state.settings.conservativeMode
    },
    summary: {
      totalDailyLogs: state.dailyLogs.length,
      totalWorkouts: state.workouts.length
    }
  };
}

async function generateAdvice() {
  if (cloudAdviceConfigured && state.settings.cloudAdviceConsentVersion !== CLOUD_ADVICE_CONSENT_VERSION) {
    openCloudConsentDialog();
    return;
  }
  return generateAdviceWithMode(cloudAdviceConfigured);
}

async function generateAdviceWithMode(useCloud) {
  return withButtonBusy("generateAdviceBtn", "生成中", async () => {
    $("adviceOutput").innerHTML = `
      <div class="coach-empty">
        <strong>正在生成建议</strong>
        <p class="muted">系统正在读取最近的日常状态、训练负荷和疼痛记录。</p>
      </div>
    `;
    const payload = buildAdvicePayload();
    if (!useCloud) {
      saveAdvice(generateLocalAdvice(payload, "用户选择本地建议"), "本地规则");
      return;
    }
    try {
      const response = await fetch("/api/advice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI 服务不可用");
      saveAdvice(data.advice, `OpenAI ${data.model}`);
    } catch (error) {
      const localAdvice = generateLocalAdvice(payload, error.message);
      saveAdvice(localAdvice, "本地规则");
    }
  });
}

function openCloudConsentDialog() {
  const dialog = $("cloudConsentDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  $("useLocalAdviceBtn").focus();
}

function closeCloudConsentDialog() {
  const dialog = $("cloudConsentDialog");
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function chooseLocalAdvice() {
  closeCloudConsentDialog();
  return generateAdviceWithMode(false);
}

function confirmCloudAdviceConsent() {
  state.settings.cloudAdviceConsentVersion = CLOUD_ADVICE_CONSENT_VERSION;
  saveState();
  renderCloudConsentStatus();
  closeCloudConsentDialog();
  return generateAdviceWithMode(true);
}

function revokeCloudAdviceConsent() {
  state.settings.cloudAdviceConsentVersion = 0;
  saveState();
  renderCloudConsentStatus();
  showToast("云端建议授权已撤回");
}

function renderCloudConsentStatus() {
  const status = $("cloudConsentStatus");
  const revokeButton = $("revokeCloudConsentBtn");
  if (!status || !revokeButton) return;
  const consented = state.settings.cloudAdviceConsentVersion === CLOUD_ADVICE_CONSENT_VERSION;
  status.textContent = !cloudAdviceConfigured
    ? "当前为本地建议模式，不会发送记录"
    : consented
      ? "已允许云端建议，可随时撤回"
      : "首次使用云端建议前会询问你的同意";
  revokeButton.hidden = !consented;
}

function saveAdvice(text, source) {
  state.adviceHistory.push({
    id: uid("advice"),
    source,
    text: `${text}\n\n来源：${source}`,
    createdAt: new Date().toISOString()
  });
  saveState();
  showToast("建议已生成");
}

function generateLocalAdvice(payload, reason) {
  const recentDaily = payload.dailyLogs;
  const recentWorkouts = payload.workouts;
  const avgSleep = average(recentDaily.map(item => item.sleepHours).filter(value => value !== null));
  const avgEnergy = average(recentDaily.map(item => item.energy));
  const avgPain = average(recentDaily.map(item => item.pain));
  const highRpeWorkouts = recentWorkouts.filter(item => item.sessionRpe >= 8).length;
  const totalSets = recentWorkouts.reduce((sum, workout) => sum + countSets(workout), 0);
  const lines = [];

  lines.push("最近总结");
  lines.push(`- 最近记录了 ${recentDaily.length} 条日常、${recentWorkouts.length} 次训练、${totalSets} 个训练组。`);
  if (avgSleep !== null) lines.push(`- 平均睡眠约 ${avgSleep.toFixed(1)} 小时。`);
  if (avgEnergy !== null) lines.push(`- 平均精力为 ${avgEnergy.toFixed(1)}/5。`);

  lines.push("\n训练建议");
  if (!recentWorkouts.length) {
    lines.push("- 先从一次完整训练记录开始，至少记下动作、重量、次数和主观难度。");
  } else if (highRpeWorkouts >= 3) {
    lines.push("- 最近高难度训练偏多，下一次可以减少 10%-20% 总组数，优先保证动作质量。");
  } else {
    lines.push("- 如果睡眠和疼痛都稳定，下一次可在一个核心动作上小幅加重量或多做一组。");
  }

  lines.push("\n恢复建议");
  if (avgSleep !== null && avgSleep < 6.5) {
    lines.push("- 睡眠偏少，训练进步可能被恢复限制。优先把睡眠拉回 7 小时左右。");
  } else {
    lines.push("- 当前恢复记录没有明显红灯，继续保持睡眠、饮水和训练备注的记录。");
  }

  lines.push("\n风险提醒");
  if (avgPain !== null && avgPain >= 2) {
    lines.push("- 最近疼痛评分不低。避免硬顶强度，若疼痛持续或加重，建议咨询专业人士。");
  } else {
    lines.push("- 暂未看到持续疼痛信号，但训练备注里最好继续记录不适部位。");
  }

  lines.push("\n下一步行动");
  lines.push("- 接下来 3 天至少记录一次睡眠、精力和训练 RPE，这会让建议更准确。");
  lines.push(`\n备注：未连接真实 AI，本次使用本地规则生成。原因：${reason}`);
  return lines.join("\n");
}

function exportData() {
  state.settings.lastBackupAt = new Date().toISOString();
  persistState();
  const blob = new Blob([JSON.stringify(buildBackupPayload(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `habit-fitness-backup-${today()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  renderDataHealth();
  showToast("JSON 完整备份已导出");
}

function buildBackupPayload() {
  return {
    ...state,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: state.settings.lastBackupAt || new Date().toISOString()
  };
}

function exportCsvSummary() {
  const csv = buildCsvSummary();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `habit-fitness-summary-${today()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("CSV 汇总已导出");
}

function buildCsvSummary() {
  const header = ["type", "date", "title", "metric_1", "metric_2", "metric_3", "note"];
  const dailyRows = state.dailyLogs
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(log => [
      "daily",
      log.date,
      "生活状态",
      `sleep=${log.sleepHours ?? ""}`,
      `water=${log.waterMl ?? 0}`,
      `energy=${log.energy}/5 pain=${log.pain}/5`,
      log.note || ""
    ]);
  const workoutRows = state.workouts
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(workout => [
      "workout",
      workout.date,
      workout.title,
      `duration=${workout.duration ?? ""}`,
      `sets=${countSets(workout)}`,
      `rpe=${workout.sessionRpe ?? ""}`,
      [
        workout.exercises.map(item => item.name).join(" / "),
        workout.note || ""
      ].filter(Boolean).join(" | ")
    ]);
  const rows = [header, ...dailyRows, ...workoutRows];
  return rows.map(row => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

async function exportWeeklyReport() {
  const report = buildWeeklyReportText();
  try {
    const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `habit-fitness-weekly-report-${today()}.md`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("周报已导出");
  } catch {
    try {
      await navigator.clipboard.writeText(report);
      showToast("下载不可用，周报已复制");
    } catch {
      showToast("周报导出失败，请稍后再试");
    }
  }
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      const preview = validateImportPayload(imported, file.name);
      pendingImport = preview.canImport ? { imported, preview } : { imported: null, preview };
      renderImportPreview();
      showToast(preview.canImport ? "导入预览已生成" : "导入文件需要修复");
    } catch {
      pendingImport = null;
      renderImportPreview();
      showToast("导入失败：JSON 格式不正确");
    }
  };
  reader.readAsText(file);
}

function validateImportPayload(imported, fileName = "backup.json") {
  const issues = [];
  if (!imported || typeof imported !== "object" || Array.isArray(imported)) {
    return {
      fileName,
      canImport: false,
      summary: "文件不是有效的应用备份对象。",
      metrics: [],
      issues: ["JSON 顶层必须是对象。"]
    };
  }

  const schemaVersion = imported.schemaVersion ?? 1;
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    issues.push("备份格式版本无效。");
  } else if (schemaVersion > BACKUP_SCHEMA_VERSION) {
    issues.push(`此备份使用 v${schemaVersion} 格式，当前应用仅支持到 v${BACKUP_SCHEMA_VERSION}。请先升级应用。`);
  }

  const dailyLogs = Array.isArray(imported.dailyLogs) ? imported.dailyLogs : [];
  const workouts = Array.isArray(imported.workouts) ? imported.workouts : [];
  const exercises = Array.isArray(imported.exercises) ? imported.exercises : [];
  const templates = Array.isArray(imported.templates) ? imported.templates : [];
  const adviceHistory = Array.isArray(imported.adviceHistory) ? imported.adviceHistory : [];

  if ("dailyLogs" in imported && !Array.isArray(imported.dailyLogs)) issues.push("dailyLogs 必须是数组。");
  if ("workouts" in imported && !Array.isArray(imported.workouts)) issues.push("workouts 必须是数组。");
  if ("exercises" in imported && !Array.isArray(imported.exercises)) issues.push("exercises 必须是数组。");
  if ("templates" in imported && !Array.isArray(imported.templates)) issues.push("templates 必须是数组。");
  if (!dailyLogs.length && !workouts.length && !exercises.length && !templates.length) {
    issues.push("没有发现可导入的日常、训练、动作或模板数据。");
  }

  const invalidDaily = dailyLogs.filter(log => !isValidDateText(log?.date)).length;
  const invalidWorkouts = workouts.filter(workout => !isValidDateText(workout?.date) || !Array.isArray(workout?.exercises)).length;
  const invalidSets = workouts.reduce((sum, workout) => {
    if (!Array.isArray(workout?.exercises)) return sum;
    return sum + workout.exercises.reduce((inner, exercise) => (
      inner + (Array.isArray(exercise?.sets) ? 0 : 1)
    ), 0);
  }, 0);
  if (invalidDaily) issues.push(`${invalidDaily} 条日常记录缺少有效日期。`);
  if (invalidWorkouts) issues.push(`${invalidWorkouts} 次训练缺少有效日期或动作列表。`);
  if (invalidSets) issues.push(`${invalidSets} 个训练动作缺少组数据数组。`);

  const blockingIssues = issues.filter(issue => !issue.includes("没有发现"));
  const canImport = issues.length === 0;
  return {
    fileName,
    canImport,
    summary: canImport
      ? "确认后会覆盖当前浏览器里的本地数据。"
      : blockingIssues.length ? "文件结构存在问题，暂不覆盖本地数据。" : "文件里没有可恢复的数据。",
    metrics: [
      { label: "格式", value: `v${Number.isInteger(schemaVersion) ? schemaVersion : "?"}` },
      { label: "日常", value: `${dailyLogs.length} 条` },
      { label: "训练", value: `${workouts.length} 次` },
      { label: "动作", value: `${exercises.length} 个` },
      { label: "模板", value: `${templates.length} 个` },
      { label: "建议", value: `${adviceHistory.length} 条` }
    ],
    issues
  };
}

function isValidDateText(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeImportedState(imported) {
  return {
    dailyLogs: Array.isArray(imported.dailyLogs) ? imported.dailyLogs : [],
    workouts: Array.isArray(imported.workouts) ? imported.workouts : [],
    exercises: mergeDefaultExercises(imported.exercises),
    templates: Array.isArray(imported.templates) ? imported.templates : [],
    adviceHistory: Array.isArray(imported.adviceHistory) ? imported.adviceHistory : [],
    settings: normalizeSettings(imported.settings)
  };
}

function confirmImportData() {
  if (!pendingImport?.imported || !pendingImport.preview.canImport) {
    showToast("没有可导入的数据");
    return;
  }
  Object.assign(state, normalizeImportedState(pendingImport.imported));
  pendingImport = null;
  clearWorkoutDraft();
  saveState();
  clearWorkoutForm();
  renderAll();
  showToast("数据已导入并覆盖本地记录");
}

function cancelImportData() {
  pendingImport = null;
  renderImportPreview();
  showToast("已取消导入");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

async function checkAiStatus() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    cloudAdviceConfigured = Boolean(data.openaiConfigured);
    $("aiStatus").textContent = cloudAdviceConfigured ? `云端教练已连接 · ${data.model}` : "本地建议模式";
  } catch {
    cloudAdviceConfigured = false;
    $("aiStatus").textContent = "离线可用 · 本地建议";
  }
  renderCloudConsentStatus();
}

function updateOfflineStatus(message = "") {
  const status = $("offlineStatus");
  if (!status) return;
  const isOnline = navigator.onLine;
  status.textContent = message || (isOnline ? "可离线打开" : "当前离线");
  status.classList.toggle("offline", !isOnline);
}

function showAppUpdate(registration) {
  if (!registration?.waiting) return;
  pendingAppUpdate = registration;
  $("appUpdateBanner").hidden = false;
  updateOfflineStatus("新版本可用");
}

function dismissAppUpdate() {
  $("appUpdateBanner").hidden = true;
}

function applyAppUpdate() {
  if (!pendingAppUpdate?.waiting) {
    showToast("更新正在准备，请稍后再试");
    return;
  }
  updateReloadRequested = true;
  $("applyAppUpdateBtn").disabled = true;
  $("applyAppUpdateBtn").textContent = "更新中";
  pendingAppUpdate.waiting.postMessage({ type: "SKIP_WAITING" });
}

function isStandaloneApp() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

function updateInstallStatus(message = "") {
  const status = $("installStatus");
  const button = $("installAppBtn");
  if (!status || !button) return;

  const installed = isStandaloneApp();
  const canPrompt = Boolean(installPromptEvent);
  status.classList.toggle("success", installed);
  status.classList.toggle("ready", canPrompt && !installed);

  if (installed) {
    status.textContent = message || "已安装应用";
    button.hidden = true;
    return;
  }

  if (canPrompt) {
    status.textContent = message || "可安装到桌面";
    button.hidden = false;
    button.disabled = false;
    button.textContent = "安装应用";
    return;
  }

  status.textContent = message || "可用浏览器菜单安装";
  button.hidden = true;
}

function handleBeforeInstallPrompt(event) {
  event.preventDefault();
  installPromptEvent = event;
  updateInstallStatus("可安装到桌面");
}

async function installApp() {
  const button = $("installAppBtn");
  if (!installPromptEvent) {
    showToast("当前浏览器没有提供安装入口");
    updateInstallStatus();
    return;
  }

  button.disabled = true;
  button.textContent = "安装中";
  try {
    await installPromptEvent.prompt();
    const choice = await installPromptEvent.userChoice;
    installPromptEvent = null;
    if (choice?.outcome === "accepted") {
      showToast("应用安装已开始");
      updateInstallStatus("安装已开始");
    } else {
      showToast("已取消安装");
      updateInstallStatus();
    }
  } catch {
    showToast("安装入口暂不可用");
    updateInstallStatus();
  }
}

function bindInstallPrompt() {
  updateInstallStatus();
  window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  window.addEventListener("appinstalled", () => {
    installPromptEvent = null;
    showToast("应用已安装");
    updateInstallStatus("已安装应用");
  });
}

function registerServiceWorker() {
  updateOfflineStatus();
  window.addEventListener("online", () => updateOfflineStatus("网络已恢复"));
  window.addEventListener("offline", () => updateOfflineStatus("当前离线"));
  if (!("serviceWorker" in navigator)) {
    updateOfflineStatus("浏览器不支持离线缓存");
    return;
  }

  navigator.serviceWorker.register("/sw.js")
    .then(registration => {
      updateOfflineStatus(registration.active ? "离线缓存已就绪" : "正在准备离线缓存");
      if (registration.waiting) showAppUpdate(registration);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            showAppUpdate(registration);
          }
        });
      });
    })
    .catch(() => updateOfflineStatus("离线缓存未启用"));

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!updateReloadRequested) return;
    updateReloadRequested = false;
    window.location.reload();
  });
}

function openResetDataDialog() {
  const dialog = $("resetDataDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  $("cancelResetDataBtn").focus();
}

function closeResetDataDialog() {
  const dialog = $("resetDataDialog");
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function resetAllData() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(WORKOUT_DRAFT_KEY);
  } catch {
    lastStorageIssue = "浏览器拒绝删除本地数据";
    renderDataHealth();
    showToast("无法清空数据，请检查浏览器存储权限");
    return;
  }

  const freshState = loadState();
  Object.keys(state).forEach(key => delete state[key]);
  Object.assign(state, freshState);
  pendingImport = null;
  lastWorkoutSummary = null;
  lastStorageIssue = "";
  clearWorkoutForm();
  closeResetDataDialog();
  renderAll();
  showToast("所有本地数据已清空");
}

function bindActions() {
  $("applyAppUpdateBtn").addEventListener("click", applyAppUpdate);
  $("dismissAppUpdateBtn").addEventListener("click", dismissAppUpdate);
  $("saveDailyBtn").addEventListener("click", saveDaily);
  $("addWaterBtn").addEventListener("click", addWaterServing);
  $("waterStepBtn").addEventListener("click", changeWaterStep);
  $("waterStepForm").addEventListener("submit", event => {
    event.preventDefault();
    saveWaterStep();
  });
  $("cancelWaterStepBtn").addEventListener("click", () => closeInputDialog("waterStepDialog"));
  $("dailyDate").addEventListener("change", event => loadDailyIntoForm(event.target.value));
  $("dailyForm").addEventListener("input", () => {
    renderDailyCoach();
    renderSafetyStrip();
    renderTodayDashboard();
    renderWeeklyTargetPanel();
  });
  $("workout").addEventListener("input", () => {
    renderWorkoutSurfaces();
    scheduleWorkoutDraftSave();
  });
  $("workout").addEventListener("change", () => {
    renderWorkoutSurfaces();
    scheduleWorkoutDraftSave();
  });
  $("saveWorkoutBtn").addEventListener("click", saveWorkoutWithFeedback);
  $("cancelWorkoutEditBtn").addEventListener("click", cancelWorkoutEdit);
  $("saveTemplateBtn").addEventListener("click", saveTemplate);
  $("templateNameForm").addEventListener("submit", event => {
    event.preventDefault();
    confirmSaveTemplate();
  });
  $("cancelTemplateNameBtn").addEventListener("click", () => closeInputDialog("templateNameDialog"));
  $("loadTemplateBtn").addEventListener("click", loadTemplate);
  $("addLibraryExerciseBtn").addEventListener("click", addLibraryExercise);
  $("savePreferencesBtn").addEventListener("click", savePreferences);
  $("installAppBtn").addEventListener("click", installApp);
  $("reminderStatus").addEventListener("click", event => {
    if (event.target.closest("#requestNotificationBtn")) requestNotificationPermission();
  });
  $("generateAdviceBtn").addEventListener("click", generateAdvice);
  $("useLocalAdviceBtn").addEventListener("click", chooseLocalAdvice);
  $("confirmCloudConsentBtn").addEventListener("click", confirmCloudAdviceConsent);
  $("revokeCloudConsentBtn").addEventListener("click", revokeCloudAdviceConsent);
  $("cloudConsentDialog").addEventListener("click", event => {
    if (event.target === $("cloudConsentDialog")) chooseLocalAdvice();
  });
  $("exportBtn").addEventListener("click", exportData);
  $("exportMirrorBtn").addEventListener("click", exportData);
  $("exportCsvBtn").addEventListener("click", exportCsvSummary);
  $("importFile").addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (file) importData(file);
    event.target.value = "";
  });
  $("resetDemoBtn").addEventListener("click", openResetDataDialog);
  $("cancelResetDataBtn").addEventListener("click", closeResetDataDialog);
  $("confirmResetDataBtn").addEventListener("click", resetAllData);
  $("resetDataDialog").addEventListener("click", event => {
    if (event.target === $("resetDataDialog")) closeResetDataDialog();
  });
  $("cancelDeleteWorkoutBtn").addEventListener("click", closeDeleteWorkoutDialog);
  $("confirmDeleteWorkoutBtn").addEventListener("click", confirmDeleteWorkout);
  $("deleteWorkoutDialog").addEventListener("click", event => {
    if (event.target === $("deleteWorkoutDialog")) closeDeleteWorkoutDialog();
  });
  $("deleteWorkoutDialog").addEventListener("close", () => {
    pendingWorkoutDeleteId = null;
  });
  $("cancelDeleteDailyBtn").addEventListener("click", closeDeleteDailyDialog);
  $("confirmDeleteDailyBtn").addEventListener("click", confirmDeleteDaily);
  $("deleteDailyDialog").addEventListener("click", event => {
    if (event.target === $("deleteDailyDialog")) closeDeleteDailyDialog();
  });
  $("deleteDailyDialog").addEventListener("close", () => {
    pendingDailyDeleteDate = null;
  });
  $("templateList").addEventListener("click", event => {
    if (!event.target.classList.contains("delete-template")) return;
    state.templates = state.templates.filter(item => item.id !== event.target.dataset.id);
    saveState();
    showToast("模板已删除");
  });
  $("focusStrip").addEventListener("click", event => {
    const card = event.target.closest(".focus-card");
    if (!card) return;
    activateTab(card.dataset.targetTab);
  });
  $("weeklyTargetPanel").addEventListener("click", event => {
    if (event.target.closest("#startWeeklyTargetWorkoutBtn")) {
      startDailyCoachWorkout();
      return;
    }
    if (event.target.closest("#openWorkoutFromWeeklyBtn")) activateTab("workout");
  });
  $("starterGuide").addEventListener("click", event => {
    if (event.target.closest("#startOnboardingRecordBtn")) {
      startOnboardingRecord();
      return;
    }
    if (event.target.closest("#viewStarterCoachBtn")) {
      viewStarterCoach();
    }
  });
  $("retentionInsights").addEventListener("click", event => {
    if (event.target.closest("#exportWeeklyReportBtn")) exportWeeklyReport();
  });
  $("historyFilter").addEventListener("change", event => {
    historyFilter = event.target.value;
    historyExpanded = false;
    renderHistory();
  });
  $("historySearch").addEventListener("input", event => {
    historySearch = event.target.value;
    historyExpanded = false;
    renderHistory();
  });
  $("toggleHistoryBtn").addEventListener("click", () => {
    historyExpanded = !historyExpanded;
    renderHistory();
  });
  $("historyList").addEventListener("click", event => {
    const workoutCard = event.target.closest("[data-workout-id]");
    if (workoutCard && event.target.closest(".edit-workout-record")) {
      editWorkoutRecord(workoutCard.dataset.workoutId);
      return;
    }
    if (workoutCard && event.target.closest(".delete-workout-record")) {
      openDeleteWorkoutDialog(workoutCard.dataset.workoutId);
      return;
    }
    const dailyCard = event.target.closest("[data-daily-date]");
    if (dailyCard && event.target.closest(".edit-daily-record")) {
      editDailyRecord(dailyCard.dataset.dailyDate);
      return;
    }
    if (dailyCard && event.target.closest(".delete-daily-record")) openDeleteDailyDialog(dailyCard.dataset.dailyDate);
  });
  $("importPreview").addEventListener("click", event => {
    if (event.target.closest("#confirmImportBtn")) {
      confirmImportData();
      return;
    }
    if (event.target.closest("#cancelImportBtn")) cancelImportData();
  });
  $("dailyCoach").addEventListener("click", event => {
    if (event.target.closest("#startCoachWorkoutBtn")) {
      startDailyCoachWorkout();
      return;
    }
    const target = event.target.closest("[data-target-tab]");
    if (target) activateTab(target.dataset.targetTab);
  });
  $("workoutExecution").addEventListener("click", event => {
    if (event.target.closest("#finishWorkoutBtn")) {
      saveWorkoutWithFeedback();
      return;
    }
    if (event.target.closest("#loadCoachWorkoutBtn")) {
      startDailyCoachWorkout();
      return;
    }
    if (event.target.closest("#executionAddExerciseBtn")) {
      addExerciseCard();
      scheduleWorkoutDraftSave();
    }
  });
  window.addEventListener("beforeunload", persistWorkoutDraft);
}

function renderWorkoutSurfaces() {
  renderWorkoutExecution();
  renderWorkoutDashboard();
}

function init() {
  setDateDefaults();
  bindTabs();
  bindRanges();
  bindWorkoutRows();
  bindActions();
  loadDailyIntoForm(today());
  const restoredWorkoutDraft = restoreWorkoutDraft();
  if (!$("exerciseRows").children.length) addExerciseCard();
  renderAll();
  $("appVersion").textContent = `本地优先 · PWA · v${APP_VERSION}`;
  if (restoredWorkoutDraft) showToast("已恢复未完成的训练草稿");
  checkAiStatus();
  bindInstallPrompt();
  registerServiceWorker();
  startReminderScheduler();
}

init();
