(function attachTrainingRotationModel(global) {
  "use strict";

  const VERSION = 1;
  const VALID_MODES = new Set(["full_body", "upper_lower", "custom"]);
  const BUILT_IN_DAYS = Object.freeze({
    full_body: Object.freeze([
      Object.freeze({ id: "rotation_full_body", templateId: "beginner_full_body", label: "全身训练" })
    ]),
    upper_lower: Object.freeze([
      Object.freeze({ id: "rotation_upper", templateId: "beginner_upper", label: "上肢训练" }),
      Object.freeze({ id: "rotation_lower", templateId: "beginner_lower", label: "下肢训练" })
    ])
  });

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
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
    VALID_MODES: Object.freeze(Array.from(VALID_MODES)),
    BUILT_IN_DAYS,
    defaultRotation,
    normalizeRotation,
    resolveNextDay,
    advanceRotation,
    findComparableWorkout,
    validObservationDates,
    progressVisibility
  });
})(globalThis);
