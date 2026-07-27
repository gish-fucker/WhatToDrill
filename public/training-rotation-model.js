(function attachTrainingRotationModel(global) {
  "use strict";

  const VERSION = 2;
  const VALID_ENVIRONMENTS = new Set(["gym", "home_bodyweight", "home_dumbbell", "mixed"]);
  const VALID_GOALS = new Set(["general", "fat_loss", "muscle_gain", "strength", "recovery"]);
  const VALID_MODES = new Set(["full_body", "upper_lower", "custom"]);
  const BUILT_IN_DAYS = Object.freeze({
    full_body: Object.freeze([
      Object.freeze({ id: "rotation_full_body", templateId: "beginner_full_body", label: "全身 A" }),
      Object.freeze({ id: "rotation_full_body_b", templateId: "beginner_full_body_b", label: "全身 B" })
    ]),
    upper_lower: Object.freeze([
      Object.freeze({ id: "rotation_upper", templateId: "beginner_upper", label: "上肢 A" }),
      Object.freeze({ id: "rotation_lower", templateId: "beginner_lower", label: "下肢 A" }),
      Object.freeze({ id: "rotation_upper_b", templateId: "beginner_upper_b", label: "上肢 B" }),
      Object.freeze({ id: "rotation_lower_b", templateId: "beginner_lower_b", label: "下肢 B" })
    ])
  });

  const ROUTINE_TEMPLATES = Object.freeze({
    gym: Object.freeze(["beginner_full_body", "beginner_full_body_b"]),
    home_bodyweight: Object.freeze(["starter_home_bodyweight", "starter_home_bodyweight_b"]),
    home_dumbbell: Object.freeze(["starter_dumbbell_full_body", "starter_dumbbell_full_body_b"]),
    mixed: Object.freeze(["starter_dumbbell_full_body", "starter_dumbbell_full_body_b"])
  });

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeEnvironment(value, equipment = "") {
    if (VALID_ENVIRONMENTS.has(value)) return value;
    if (value === "home") return equipment === "dumbbells" ? "home_dumbbell" : "home_bodyweight";
    if (equipment === "bodyweight") return "home_bodyweight";
    if (equipment === "dumbbells") return value === "gym" ? "gym" : "home_dumbbell";
    return value === "mixed" ? "mixed" : "gym";
  }

  function routineTemplateIds(environment, equipment = "") {
    return [...ROUTINE_TEMPLATES[normalizeEnvironment(environment, equipment)]];
  }

  function applyGoalPrescription(template, goal = "general") {
    if (!template || !Array.isArray(template.exercises)) return null;
    const normalizedGoal = VALID_GOALS.has(goal) ? goal : "general";
    const prescribed = clone(template);
    prescribed.goal = normalizedGoal;
    prescribed.exercises = prescribed.exercises.map((exercise, exerciseIndex) => {
      let sets = Array.isArray(exercise.sets) ? exercise.sets.map(set => ({ ...set })) : [];
      if (normalizedGoal === "general") sets = sets.slice(0, Math.min(2, sets.length));
      if (normalizedGoal === "muscle_gain") {
        const seed = sets[0] || { weight: null, reps: 10, rpe: 6, note: "" };
        while (sets.length < 3) sets.push({ ...seed });
        sets = sets.slice(0, 3).map(set => ({ ...set, reps: Math.max(8, Number(set.reps) || 10), rpe: 7 }));
      }
      if (normalizedGoal === "strength") {
        const count = exerciseIndex < 2 ? 3 : 2;
        const seed = sets[0] || { weight: null, reps: 5, rpe: 6, note: "" };
        while (sets.length < count) sets.push({ ...seed });
        sets = sets.slice(0, count).map(set => ({ ...set, reps: exerciseIndex < 2 ? 5 : Math.min(8, Number(set.reps) || 8), rpe: 6 }));
      }
      if (normalizedGoal === "fat_loss") sets = sets.slice(0, Math.min(2, sets.length)).map(set => ({ ...set, reps: Math.max(10, Number(set.reps) || 10), rpe: 6 }));
      if (normalizedGoal === "recovery") sets = sets.slice(0, 1).map(set => ({ ...set, weight: null, reps: Math.min(8, Number(set.reps) || 8), rpe: 3 }));
      return { ...exercise, sets };
    });
    if (normalizedGoal === "fat_loss" && !prescribed.exercises.some(exercise => exercise.name === "轻松快走")) {
      prescribed.exercises.push({ name: "轻松快走", metric: "minutes", sets: [{ weight: null, reps: 8, rpe: 3, note: "保持能正常说话的速度" }] });
    }
    prescribed.sessionRpe = normalizedGoal === "recovery" ? 3 : normalizedGoal === "muscle_gain" ? 7 : 6;
    prescribed.progression = {
      general: "稳定完成后小幅增加次数或重量",
      fat_loss: "先稳定完成力量动作，再逐步延长低强度活动",
      muscle_gain: "先把每组次数提高到区间上限，再小幅加重量",
      strength: "主要动作低次数，稳定完成后保守加重量",
      recovery: "不推进负荷，避免力竭"
    }[normalizedGoal];
    return prescribed;
  }

  function templateMap(templates = []) {
    return new Map((Array.isArray(templates) ? templates : [])
      .filter(template => text(template?.id))
      .map(template => [text(template.id), template]));
  }

  function defaultRotation() {
    return {
      version: VERSION,
      mode: "full_body",
      days: clone(BUILT_IN_DAYS.full_body),
      currentIndex: 0,
      updatedAt: "",
      issue: ""
    };
  }

  function normalizeCustomDays(days, templates) {
    const available = templateMap(templates);
    const ids = new Set();
    return (Array.isArray(days) ? days : []).slice(0, 6).map((day, index) => {
      const templateId = text(day?.templateId);
      if (!templateId || !available.has(templateId)) return null;
      let id = text(day?.id) || `rotation_custom_${index + 1}_${templateId}`;
      while (ids.has(id)) id = `${id}_${index + 1}`;
      ids.add(id);
      return {
        id,
        templateId,
        label: text(day?.label) || text(available.get(templateId)?.name) || `训练日 ${index + 1}`
      };
    }).filter(Boolean);
  }

  function normalizeRotation(rotation = {}, templates = []) {
    const mode = VALID_MODES.has(rotation?.mode) ? rotation.mode : "full_body";
    let days;
    let issue = "";
    if (mode === "custom") {
      days = normalizeCustomDays(rotation.days, templates);
      if (days.length < 2) {
        const fallback = defaultRotation();
        return { ...fallback, issue: "自定义训练顺序至少需要 2 个仍然存在的训练模板，已暂时使用全身循环。" };
      }
    } else {
      days = clone(BUILT_IN_DAYS[mode]);
    }
    const rawIndex = Number(rotation?.currentIndex);
    const currentIndex = Number.isInteger(rawIndex) && rawIndex >= 0 ? rawIndex % days.length : 0;
    return {
      version: VERSION,
      mode,
      days,
      currentIndex,
      updatedAt: Number.isFinite(Date.parse(rotation?.updatedAt)) ? new Date(rotation.updatedAt).toISOString() : "",
      issue
    };
  }

  function resolveNextDay(rotation, templates = []) {
    const normalized = normalizeRotation(rotation, templates);
    const day = normalized.days[normalized.currentIndex] || normalized.days[0];
    const template = templateMap(templates).get(day.templateId) || null;
    return {
      rotation: normalized,
      day: { ...day },
      template,
      isBaseline: true
    };
  }

  function advanceRotation(rotation, rotationDayId, templates = [], updatedAt = new Date().toISOString()) {
    const normalized = normalizeRotation(rotation, templates);
    const index = normalized.days.findIndex(day => day.id === rotationDayId);
    if (index < 0) return { ...normalized, issue: "所选训练日已不在当前顺序中，轮换位置未改变。" };
    return {
      ...normalized,
      currentIndex: (index + 1) % normalized.days.length,
      updatedAt,
      issue: ""
    };
  }

  function findComparableWorkout(workouts, day) {
    const source = Array.isArray(workouts) ? workouts : [];
    return source
      .filter(workout => (
        text(workout?.rotationDayId) === text(day?.id)
        || (!text(workout?.rotationDayId) && text(workout?.sourceTemplateId) === text(day?.templateId))
      ))
      .sort((a, b) => `${b.date || ""}|${b.createdAt || ""}`.localeCompare(`${a.date || ""}|${a.createdAt || ""}`))[0] || null;
  }

  function findLatestExercisePerformance(workouts, exerciseName) {
    const name = text(exerciseName);
    if (!name) return null;
    const ordered = (Array.isArray(workouts) ? workouts : []).slice()
      .sort((a, b) => `${b.date || ""}|${b.createdAt || ""}`.localeCompare(`${a.date || ""}|${a.createdAt || ""}`));
    for (const workout of ordered) {
      const exercise = (Array.isArray(workout?.exercises) ? workout.exercises : []).find(item => text(item?.name) === name);
      const sets = (Array.isArray(exercise?.sets) ? exercise.sets : []).filter(set => [set?.weight, set?.reps, set?.rpe].some(value => Number.isFinite(Number(value))));
      if (sets.length) return { workout, exercise: { ...exercise, sets: clone(sets) } };
    }
    return null;
  }

  function validObservationDates(workouts = [], dailyLogs = []) {
    const trainingDates = new Set((Array.isArray(workouts) ? workouts : []).map(workout => text(workout?.date)).filter(Boolean));
    return [...new Set((Array.isArray(dailyLogs) ? dailyLogs : []).filter(log => (
      trainingDates.has(text(log?.date))
      && [log?.sleepHours, log?.energy, log?.soreness, log?.pain].some(value => value !== null && value !== undefined && value !== "")
    )).map(log => text(log.date)))].sort();
  }

  function progressVisibility(workouts = [], dailyLogs = []) {
    const source = Array.isArray(workouts) ? workouts : [];
    const exerciseCounts = new Map();
    source.forEach(workout => (Array.isArray(workout?.exercises) ? workout.exercises : []).forEach(exercise => {
      const name = text(exercise?.name);
      if (name) exerciseCounts.set(name, (exerciseCounts.get(name) || 0) + 1);
    }));
    const dates = [...new Set(source.map(workout => text(workout?.date)).filter(Boolean))].sort();
    const coverageDays = dates.length > 1
      ? Math.floor((new Date(`${dates.at(-1)}T00:00:00Z`) - new Date(`${dates[0]}T00:00:00Z`)) / 86_400_000) + 1
      : dates.length;
    const observations = validObservationDates(source, dailyLogs);
    return {
      workoutCount: source.length,
      validObservationDays: observations.length,
      coverageDays,
      empty: source.length === 0,
      recentReview: source.length >= 1,
      nextPlan: source.length >= 1,
      exerciseComparison: [...exerciseCounts.values()].some(count => count >= 2),
      weeklyTrend: source.length >= 3,
      personalPatterns: observations.length >= 7,
      personalReport: coverageDays >= 28
    };
  }

  global.TrainingRotationModel = Object.freeze({
    VERSION,
    VALID_ENVIRONMENTS: Object.freeze(Array.from(VALID_ENVIRONMENTS)),
    VALID_GOALS: Object.freeze(Array.from(VALID_GOALS)),
    VALID_MODES: Object.freeze(Array.from(VALID_MODES)),
    BUILT_IN_DAYS,
    ROUTINE_TEMPLATES,
    normalizeEnvironment,
    routineTemplateIds,
    applyGoalPrescription,
    defaultRotation,
    normalizeRotation,
    resolveNextDay,
    advanceRotation,
    findComparableWorkout,
    findLatestExercisePerformance,
    validObservationDates,
    progressVisibility
  });
})(globalThis);
