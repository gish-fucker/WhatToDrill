const STORAGE_KEY = "habit_fitness_app_v1";

const defaultExercises = [
  { name: "深蹲", category: "力量", lastUsed: "" },
  { name: "卧推", category: "力量", lastUsed: "" },
  { name: "硬拉", category: "力量", lastUsed: "" },
  { name: "划船", category: "力量", lastUsed: "" },
  { name: "肩推", category: "力量", lastUsed: "" },
  { name: "引体向上", category: "力量", lastUsed: "" },
  { name: "跑步", category: "有氧", lastUsed: "" },
  { name: "平板支撑", category: "核心", lastUsed: "" }
];

const state = loadState();

function today() {
  return new Date().toISOString().slice(0, 10);
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
        exercises: parsed.exercises?.length ? parsed.exercises : defaultExercises,
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
    exercises: defaultExercises,
    templates: [],
    adviceHistory: [],
    settings: {
      waterStepMl: 500
    }
  };
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
    }
    if (target.classList.contains("remove-set")) {
      target.closest(".set-grid").remove();
    }
    if (target.classList.contains("remove-exercise")) {
      card.remove();
      updateExerciseIndexes();
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
  saveState();
  clearWorkoutForm();
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
  const template = state.templates.find(item => item.id === id);
  if (!template) {
    showToast("还没有可载入的模板");
    return;
  }
  $("workoutTitle").value = template.name;
  $("exerciseRows").innerHTML = "";
  template.exercises.forEach(exercise => addExerciseCard(exercise));
  showToast("模板已载入");
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

  $("templateList").innerHTML = state.templates.length
    ? state.templates.map(template => `
      <article class="template-card">
        <header>
          <strong>${escapeHtml(template.name)}</strong>
          <button class="ghost-button delete-template" data-id="${template.id}" type="button">删除</button>
        </header>
        <p class="muted">${template.exercises.map(item => escapeHtml(item.name)).join("、")}</p>
        <div class="template-meta">
          <span>${template.exercises.length} 个动作</span>
          <span>${template.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0)} 组</span>
        </div>
      </article>
    `).join("")
    : emptyState("还没有模板", "在训练页把常用动作保存为模板。");

  $("templateSelect").innerHTML = state.templates.length
    ? state.templates.map(template => `<option value="${template.id}">${escapeHtml(template.name)}</option>`).join("")
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
    $("adviceOutput").textContent = `${latest.createdAt.slice(0, 16).replace("T", " ")}\n\n${latest.text}`;
  }
}

function renderAll() {
  renderFocusStrip();
  renderReadiness();
  renderSummary();
  renderTrends();
  renderHistory();
  renderLibrary();
  renderWorkoutExerciseOptions();
  renderAdvice();
  updateWaterStepUi();
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

function calculateReadiness() {
  const latestDaily = state.dailyLogs
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
    $("adviceOutput").textContent = "正在生成建议...";
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
      state.exercises = imported.exercises?.length ? imported.exercises : defaultExercises;
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
    $("aiStatus").textContent = data.openaiConfigured ? `AI 已连接 · ${data.model}` : "AI 未配置 · 使用本地建议";
  } catch {
    $("aiStatus").textContent = "纯静态模式 · 使用本地建议";
  }
}

function bindActions() {
  $("saveDailyBtn").addEventListener("click", saveDaily);
  $("addWaterBtn").addEventListener("click", addWaterServing);
  $("waterStepBtn").addEventListener("click", changeWaterStep);
  $("dailyDate").addEventListener("change", event => loadDailyIntoForm(event.target.value));
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
