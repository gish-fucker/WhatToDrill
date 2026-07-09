const STORAGE_KEY = "habit_fitness_app_v1";

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

function beginnerSets(count, weight, reps, rpe, note) {
  return Array.from({ length: count }, () => ({ weight, reps, rpe, note }));
}

function today() {
  const date = new Date();
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
        settings: {
          waterStepMl: sanitizeWaterStep(parsed.settings?.waterStepMl)
        }
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
    settings: {
      waterStepMl: 500
    }
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
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
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  });
}

function activateTab(tabId) {
  const tab = document.querySelector(`.tab[data-tab="${tabId}"]`);
  const panel = $(tabId);
  if (!tab || !panel) return;
  document.querySelectorAll(".tab").forEach(item => item.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(item => item.classList.remove("active"));
  tab.classList.add("active");
  panel.classList.add("active");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bindRanges() {
  ["mood", "energy", "soreness", "pain", "sessionRpe"].forEach(id => {
    const input = $(id);
    const output = $(`${id}Value`);
    input.addEventListener("input", () => {
      output.textContent = input.value;
    });
  });
}

function sanitizeWaterStep(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 500;
  return Math.round(parsed);
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
  const current = sanitizeWaterStep(state.settings.waterStepMl);
  const next = window.prompt("每次点击增加多少 ml？例如 100、200、500", String(current));
  if (next === null) return;
  const parsed = sanitizeWaterStep(next);
  state.settings.waterStepMl = parsed;
  saveState();
  updateWaterStepUi();
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
  updateExerciseIndexes();
  renderWorkoutExecution();
  renderWorkoutDashboard();
}

function addSetRow(card, set = { weight: "", reps: "", rpe: 7, note: "" }) {
  const row = document.createElement("div");
  row.className = "set-grid";
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
  $("addExerciseRowBtn").addEventListener("click", () => addExerciseCard());
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
  });
}

function updateExerciseIndexes() {
  document.querySelectorAll(".exercise-card").forEach((card, index) => {
    const label = card.querySelector(".exercise-index");
    if (label) label.textContent = String(index + 1).padStart(2, "0");
  });
}

function collectWorkoutExercises() {
  return Array.from(document.querySelectorAll(".exercise-card")).map(card => {
    const name = card.querySelector(".exercise-name").value;
    const sets = Array.from(card.querySelectorAll(".set-grid")).map(row => ({
      weight: numberOrNull(row.querySelector(".set-weight").value),
      reps: numberOrNull(row.querySelector(".set-reps").value),
      rpe: numberOrNull(row.querySelector(".set-rpe").value),
      note: row.querySelector(".set-note").value.trim()
    })).filter(set => set.weight !== null || set.reps !== null || set.note);
    return { name, sets };
  }).filter(exercise => exercise.name && exercise.sets.length);
}

function saveWorkout() {
  const exercises = collectWorkoutExercises();
  if (!exercises.length) {
    showToast("请至少记录一个动作和一组数据");
    return;
  }

  const workout = {
    id: uid("workout"),
    date: $("workoutDate").value || today(),
    title: $("workoutTitle").value.trim() || "未命名训练",
    duration: numberOrNull($("duration").value),
    sessionRpe: Number($("sessionRpe").value),
    note: $("workoutNote").value.trim(),
    exercises,
    createdAt: new Date().toISOString()
  };

  state.workouts.push(workout);
  markExercisesUsed(exercises, workout.date);
  lastWorkoutSummary = buildSavedWorkoutSummary(workout);
  saveState();
  clearWorkoutForm();
  renderWorkoutExecution();
  showToast("训练已保存");
}

function saveWorkoutWithFeedback() {
  return withButtonBusy("saveWorkoutBtn", "保存中", () => saveWorkout());
}

function markExercisesUsed(exercises, date) {
  exercises.forEach(item => {
    const exercise = state.exercises.find(existing => existing.name === item.name);
    if (exercise) {
      exercise.lastUsed = date;
    }
  });
}

function clearWorkoutForm() {
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
  const exercises = collectWorkoutExercises();
  if (!exercises.length) {
    showToast("请先填写动作，再保存模板");
    return;
  }
  const name = window.prompt("模板名称", $("workoutTitle").value.trim() || "常用训练");
  if (!name) return;
  state.templates.push({
    id: uid("template"),
    name,
    exercises,
    createdAt: new Date().toISOString()
  });
  saveState();
  showToast("模板已保存");
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

function renderHistory() {
  const dailyCards = state.dailyLogs
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .map(log => `
      <article class="history-card">
        <header><strong>${escapeHtml(log.date)}</strong><span class="type-pill">日常</span></header>
        <p class="muted">睡眠 ${log.sleepHours ?? "未填"}h · 精力 ${log.energy}/5 · 心情 ${log.mood}/5 · 疼痛 ${log.pain}/5</p>
        ${log.note ? `<p>${escapeHtml(log.note)}</p>` : ""}
      </article>
    `);

  const workoutCards = state.workouts
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .map(workout => `
      <article class="history-card">
        <header><strong>${escapeHtml(workout.date)} ${escapeHtml(workout.title)}</strong><span class="type-pill workout-pill">训练</span></header>
        <p class="muted">${workout.exercises.length} 个动作 · ${countSets(workout)} 组 · RPE ${workout.sessionRpe}/10</p>
        <p>${workout.exercises.map(item => escapeHtml(item.name)).join("、")}</p>
      </article>
    `);

  $("historyList").innerHTML = [...workoutCards, ...dailyCards].join("") || `<p class="muted">还没有历史记录。</p>`;
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
}

function emptyState(title, text) {
  return `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <p class="muted">${escapeHtml(text)}</p>
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
  renderTodayDashboard();
  renderWorkoutExecution();
  renderWorkoutDashboard();
  renderFocusStrip();
  renderStarterGuide();
  renderReadiness();
  renderWeeklyReview();
  renderSummary();
  renderTrends();
  renderHistory();
  renderLibrary();
  renderWorkoutExerciseOptions();
  renderAdvice();
  updateWaterStepUi();
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
      <button id="finishWorkoutBtn" type="button">完成并保存</button>
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
    const rows = Array.from(card.querySelectorAll(".set-grid")).map(row => ({
      weight: numberOrNull(row.querySelector(".set-weight").value),
      reps: numberOrNull(row.querySelector(".set-reps").value),
      rpe: numberOrNull(row.querySelector(".set-rpe").value),
      note: row.querySelector(".set-note").value.trim()
    }));
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
  const completedSets = rows.filter(set => set.weight !== null || isActualSetNote(set.note)).length;
  const avgRpe = average(rows.map(set => set.rpe).filter(value => value !== null));
  const percent = plannedSets ? clamp(Math.round(completedSets / plannedSets * 100), 0, 100) : 0;
  return { plannedSets, completedSets, avgRpe, percent };
}

function isActualSetNote(note) {
  if (!note) return false;
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
  const hasStarted = state.dailyLogs.length || state.workouts.length || state.adviceHistory.length;
  if (hasStarted) {
    guide.hidden = true;
    guide.innerHTML = "";
    return;
  }

  guide.hidden = false;
  guide.innerHTML = `
    <div class="starter-copy">
      <p class="eyebrow">Start</p>
      <h2>用三条记录建立你的个人节奏</h2>
      <p class="muted">先记录今天的状态，再补一组训练数据，系统就能开始把生活、训练和恢复连起来。</p>
    </div>
    <div class="starter-steps">
      ${starterStep("01", "记录今日状态", "睡眠、饮水、精力和疼痛是所有建议的基础。", "today")}
      ${starterStep("02", "添加首次训练", "哪怕只有一个动作，也能开始形成训练负荷。", "workout")}
      ${starterStep("03", "生成第一条建议", "有了记录后，洞察页会整理出下一步行动。", "insights")}
    </div>
  `;
}

function starterStep(index, title, text, targetTab) {
  return `
    <button class="starter-step" type="button" data-target-tab="${escapeAttr(targetTab)}">
      <span>${escapeHtml(index)}</span>
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(text)}</small>
    </button>
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
  } else if ((sleep !== null && sleep < 6 && soreness >= 4) || hardLast3.length >= 2) {
    statusKey = "light";
    statusLabel = "轻量练";
    template = pickBeginnerTemplate("light", latestWorkout);
    summary = "今天适合保留训练习惯，但不要追求加量。";
    intensityText = "目标 RPE 5-6，动作慢一点。";
    if (sleep !== null && sleep < 6) reasons.push(`睡眠 ${formatMetric(sleep)}h，恢复基础偏弱。`);
    if (soreness >= 4) reasons.push(`酸痛 ${soreness}/5，肌肉还在恢复中。`);
    if (hardLast3.length >= 2) reasons.push("近 3 天高强度训练偏密集。");
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

  if (water < 1500) reasons.push(`饮水 ${water} ml 偏低，训练前先补一次水。`);
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
  const waterTarget = 2000;
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
      ${todayMetric("饮水", `${water} ml`, `${waterRatio}% 目标`, waterRatio)}
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
  if ((daily.waterMl ?? 0) < 1500) return "饮水还偏低，先补一次水，再决定今天的训练强度。";
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
  const latestAdvice = state.adviceHistory.at(-1);
  const readiness = calculateReadiness();
  const water = daily?.waterMl ?? 0;
  const workoutText = latestWorkout ? `${latestWorkout.date} · ${latestWorkout.title}` : "暂无训练";
  const nextAction = !daily
    ? "记录今日状态"
    : water < 1500
      ? "补一次饮水"
      : latestAdvice
        ? "查看最新建议"
        : "生成智能建议";

  $("focusStrip").innerHTML = [
    focusCard("今日饮水", `${water} ml`, water >= 1500 ? "状态稳定" : "偏低", "today"),
    focusCard("最近训练", workoutText, latestWorkout ? `${countSets(latestWorkout)} 组` : "等待记录", "workout"),
    focusCard("状态评分", `${readiness.score}/100`, readiness.label, "insights"),
    focusCard("下一步", nextAction, latestAdvice ? "建议已就绪" : "保持节奏", latestAdvice ? "insights" : "today")
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
  const startText = start.toISOString().slice(0, 10);
  return items.filter(item => item.date >= startText);
}

function daysBetween(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);
  return Math.max(0, Math.round((to - from) / 86400000));
}

function getLastDays(count) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (count - index - 1));
    return date.toISOString().slice(0, 10);
  });
}

function countSets(workout) {
  return workout.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
}

function buildAdvicePayload() {
  return {
    generatedAt: new Date().toISOString(),
    dailyLogs: state.dailyLogs.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14),
    workouts: state.workouts.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10),
    exercises: state.exercises,
    summary: {
      totalDailyLogs: state.dailyLogs.length,
      totalWorkouts: state.workouts.length
    }
  };
}

async function generateAdvice() {
  return withButtonBusy("generateAdviceBtn", "生成中", async () => {
    $("adviceOutput").innerHTML = `
      <div class="coach-empty">
        <strong>正在生成建议</strong>
        <p class="muted">系统正在读取最近的日常状态、训练负荷和疼痛记录。</p>
      </div>
    `;
    const payload = buildAdvicePayload();
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
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `habit-fitness-backup-${today()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      state.dailyLogs = imported.dailyLogs || [];
      state.workouts = imported.workouts || [];
      state.exercises = mergeDefaultExercises(imported.exercises);
      state.templates = imported.templates || [];
      state.adviceHistory = imported.adviceHistory || [];
      state.settings = {
        waterStepMl: sanitizeWaterStep(imported.settings?.waterStepMl)
      };
      saveState();
      showToast("数据已导入");
    } catch {
      showToast("导入失败：JSON 格式不正确");
    }
  };
  reader.readAsText(file);
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
    $("aiStatus").textContent = data.openaiConfigured ? `云端教练已连接 · ${data.model}` : "本地建议模式";
  } catch {
    $("aiStatus").textContent = "离线可用 · 本地建议";
  }
}

function bindActions() {
  $("saveDailyBtn").addEventListener("click", saveDaily);
  $("addWaterBtn").addEventListener("click", addWaterServing);
  $("waterStepBtn").addEventListener("click", changeWaterStep);
  $("dailyDate").addEventListener("change", event => loadDailyIntoForm(event.target.value));
  $("dailyForm").addEventListener("input", () => {
    renderDailyCoach();
    renderTodayDashboard();
  });
  $("workout").addEventListener("input", renderWorkoutSurfaces);
  $("workout").addEventListener("change", renderWorkoutSurfaces);
  $("saveWorkoutBtn").addEventListener("click", saveWorkoutWithFeedback);
  $("saveTemplateBtn").addEventListener("click", saveTemplate);
  $("loadTemplateBtn").addEventListener("click", loadTemplate);
  $("addLibraryExerciseBtn").addEventListener("click", addLibraryExercise);
  $("generateAdviceBtn").addEventListener("click", generateAdvice);
  $("exportBtn").addEventListener("click", exportData);
  $("exportMirrorBtn").addEventListener("click", exportData);
  $("importFile").addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (file) importData(file);
    event.target.value = "";
  });
  $("resetDemoBtn").addEventListener("click", () => {
    if (window.confirm("确定清空所有本地记录吗？")) {
      localStorage.removeItem(STORAGE_KEY);
      Object.assign(state, loadState());
      clearWorkoutForm();
      renderAll();
      showToast("数据已清空");
    }
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
  $("starterGuide").addEventListener("click", event => {
    const step = event.target.closest(".starter-step");
    if (!step) return;
    activateTab(step.dataset.targetTab);
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
    }
  });
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
  if (!$("exerciseRows").children.length) addExerciseCard();
  renderAll();
  checkAiStatus();
}

init();
