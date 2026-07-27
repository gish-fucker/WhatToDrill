(function attachTrainingRotationModel(global) {
  "use strict";

  const VERSION = 2;
  const RECOMMENDATION_ALGORITHM_VERSION = "golden-1";
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

  function normalizeEquipment(value, environment = "gym") {
    if (["bodyweight", "dumbbells", "machines", "free_weights"].includes(value)) return value;
    const normalizedEnvironment = normalizeEnvironment(environment, value);
    if (normalizedEnvironment === "home_bodyweight") return "bodyweight";
    if (["home_dumbbell", "mixed"].includes(normalizedEnvironment)) return "dumbbells";
    return "";
  }

  function hasNumericSignal(value) {
    return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  }

  function equipmentConstraint(environment, equipment) {
    const normalizedEnvironment = normalizeEnvironment(environment, equipment);
    const normalizedEquipment = normalizeEquipment(equipment, normalizedEnvironment);
    let allowedEquipment;
    let mode = "EXPLICIT_EQUIPMENT_ONLY";
    if (normalizedEquipment === "bodyweight") allowedEquipment = ["bodyweight"];
    else if (normalizedEquipment === "dumbbells") allowedEquipment = ["bodyweight", "dumbbells"];
    else if (normalizedEquipment === "machines") allowedEquipment = ["bodyweight", "machines"];
    else if (normalizedEquipment === "free_weights") allowedEquipment = ["bodyweight", "free_weights"];
    else {
      allowedEquipment = ["bodyweight", "dumbbells", "machines", "free_weights"];
      mode = "LEGACY_GYM_COMPATIBLE";
    }
    return { normalizedEnvironment, equipment: normalizedEquipment, allowedEquipment, mode };
  }

  function inferredExerciseEquipment(template, exercise) {
    const explicit = Array.isArray(exercise?.requiredEquipment)
      ? exercise.requiredEquipment.filter(item => ["bodyweight", "dumbbells", "machines", "free_weights"].includes(item))
      : [];
    if (explicit.length) return explicit;
    const templateId = text(template?.id);
    const name = text(exercise?.name);
    if (["椅子深蹲", "墙壁俯卧撑", "臀桥", "鸟狗式", "分腿蹲", "斜板俯卧撑", "单腿臀桥", "死虫", "平板支撑", "快走", "轻松快走", "动态拉伸", "髋部活动"].includes(name)) return ["bodyweight"];
    if (templateId.startsWith("starter_home_bodyweight") || templateId === "beginner_recovery") return ["bodyweight"];
    if (templateId.startsWith("starter_dumbbell")) return ["dumbbells"];
    if (templateId === "starter_gym_machines") return ["machines"];
    if (templateId === "starter_free_weights") return ["free_weights"];
    if (["腿举", "器械推胸", "高位下拉", "坐姿划船"].includes(name)) return ["machines"];
    if (["卧推", "罗马尼亚硬拉", "高脚杯深蹲", "哑铃卧推", "单臂哑铃划船", "哑铃肩推", "哑铃地板卧推", "哑铃反向弓步", "哑铃相扑硬拉"].includes(name)) return ["free_weights"];
    return ["bodyweight"];
  }

  function recommendationSelection(input, constraint) {
    const templates = Array.isArray(input?.templates) ? input.templates : [];
    const rotation = normalizeRotation(input?.rotation, templates);
    const requestedDay = text(input?.requestedDayId)
      ? rotation.days.find(day => day.id === text(input.requestedDayId))
      : null;
    const day = requestedDay || rotation.days[rotation.currentIndex] || rotation.days[0];
    let templateId = text(day?.templateId);
    if (rotation.mode === "full_body") {
      const ids = routineTemplateIds(constraint.normalizedEnvironment, constraint.equipment);
      templateId = ids[day?.id === "rotation_full_body_b" ? 1 : 0];
    } else if (rotation.mode === "upper_lower" && constraint.normalizedEnvironment !== "gym") {
      const ids = routineTemplateIds(constraint.normalizedEnvironment, constraint.equipment);
      const dayIndex = Math.max(0, rotation.days.findIndex(item => item.id === day?.id));
      templateId = ids[dayIndex % 2];
    }
    return { rotation, day, template: templates.find(item => text(item?.id) === templateId) || null, templateId };
  }

  function routineTransition(rotation, recoveryOverride = false, temporary = false) {
    const suffix = rotation.currentIndex === 1 ? "B" : "A";
    if (recoveryOverride) return `RECOVERY_HOLD_${suffix}`;
    if (temporary) return `HOLD_${suffix}_TEMPORARY_ADJUSTMENT`;
    if (rotation.mode !== "full_body") return `ROTATION_TO_${text(rotation.days[rotation.currentIndex]?.id) || "DAY"}`;
    return rotation.currentIndex === 1 ? "A_TO_B" : "B_TO_A";
  }

  function workoutSortKey(workout) {
    return `${text(workout?.date)}|${text(workout?.createdAt)}`;
  }

  function workoutFailedExercise(workout, exerciseName) {
    if (workout?.targetMet === false) return true;
    const summary = workout?.completionSummary || {};
    if ((summary.unfinishedExerciseNames || []).includes(exerciseName)) return true;
    return Number(summary.pending || 0) + Number(summary.skipped || 0) > 0;
  }

  function consecutiveExerciseFailures(workouts, exerciseName) {
    let failures = 0;
    const ordered = (Array.isArray(workouts) ? workouts : []).slice()
      .filter(workout => (workout?.exercises || []).some(exercise => text(exercise?.name) === exerciseName))
      .sort((a, b) => workoutSortKey(b).localeCompare(workoutSortKey(a)));
    for (const workout of ordered) {
      if (!workoutFailedExercise(workout, exerciseName)) break;
      failures += 1;
    }
    return failures;
  }

  function goalPrescriptionCode(goal) {
    return {
      general: "GENERAL_FOUNDATION",
      muscle_gain: "MUSCLE_GAIN_DOUBLE_PROGRESSION",
      strength: "STRENGTH_LOW_REP_CONSERVATIVE_LOAD",
      fat_loss: "FAT_LOSS_DENSITY",
      recovery: "RECOVERY_LOW_INTENSITY"
    }[VALID_GOALS.has(goal) ? goal : "general"];
  }

  function enforceGoalSets(sets, goal, exerciseIndex) {
    const result = clone(Array.isArray(sets) ? sets : []);
    const seed = result[0] || { weight: null, reps: 10, rpe: 6, note: "" };
    if (goal === "general") return result.slice(0, Math.min(2, result.length));
    if (goal === "muscle_gain") {
      while (result.length < 3) result.push({ ...seed });
      return result.slice(0, 3).map(set => ({ ...set, reps: Math.max(8, Number(set.reps) || 10), rpe: 7 }));
    }
    if (goal === "strength") {
      const count = exerciseIndex < 2 ? 3 : 2;
      while (result.length < count) result.push({ ...seed });
      return result.slice(0, count).map(set => ({ ...set, reps: exerciseIndex < 2 ? 5 : Math.min(8, Number(set.reps) || 8), rpe: 6 }));
    }
    if (goal === "fat_loss") return result.slice(0, Math.min(2, result.length)).map(set => ({ ...set, reps: Math.max(10, Number(set.reps) || 10), rpe: 6 }));
    if (goal === "recovery") return result.slice(0, 1).map(set => ({ ...set, weight: null, reps: Math.min(8, Number(set.reps) || 8), rpe: 3 }));
    return result;
  }

  function addDateDays(dateText, days) {
    const date = new Date(`${dateText}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function weekday(dateText) {
    return new Date(`${dateText}T00:00:00.000Z`).getUTCDay();
  }

  function recommendationDate(input, recoveryOverride, temporaryRecovery) {
    const currentDate = /^\d{4}-\d{2}-\d{2}$/.test(input?.currentDate) ? input.currentDate : new Date().toISOString().slice(0, 10);
    const sourceDate = /^\d{4}-\d{2}-\d{2}$/.test(input?.sourceDate) ? input.sourceDate : currentDate;
    const missed = sourceDate < currentDate;
    const baseDate = sourceDate > currentDate ? sourceDate : currentDate;
    const minimumDays = recoveryOverride || temporaryRecovery ? 2 : 1;
    const plannedDays = [...new Set((Array.isArray(input?.plannedWorkoutDays) ? input.plannedWorkoutDays : [])
      .map(Number).filter(value => Number.isInteger(value) && value >= 0 && value <= 6))];
    if (plannedDays.length) {
      for (let offset = minimumDays; offset <= 8; offset += 1) {
        const candidate = addDateDays(baseDate, offset);
        if (plannedDays.includes(weekday(candidate))) return {
          scheduledFor: candidate,
          reason: missed ? "MISSED_DATE_REBASED" : recoveryOverride || temporaryRecovery ? "RECOVERY_DELAY" : "PLANNED_WEEKDAY"
        };
      }
    }
    const target = Math.max(1, Number(input?.weeklyWorkoutTarget) || 2);
    const gap = target >= 4 ? 1 : target === 3 ? 2 : 3;
    return {
      scheduledFor: addDateDays(baseDate, Math.max(minimumDays, Math.min(3, gap))),
      reason: missed ? "MISSED_DATE_REBASED" : recoveryOverride || temporaryRecovery ? "RECOVERY_DELAY" : "TARGET_CADENCE"
    };
  }

  function goalReason(code) {
    return {
      GENERAL_FOUNDATION: "健康入门处方：控制总组数，先稳定完成动作。",
      MUSCLE_GAIN_DOUBLE_PROGRESSION: "增肌处方：先提高区间内次数，再小幅增加重量。",
      STRENGTH_LOW_REP_CONSERVATIVE_LOAD: "力量处方：主要动作使用较低次数，达标后才保守加重。",
      FAT_LOSS_DENSITY: "减脂处方：保持可控力量训练，并使用较高次数或轻松活动。",
      RECOVERY_LOW_INTENSITY: "恢复处方：本次只安排低强度、低训练量内容。"
    }[code];
  }

  function buildRecommendationDecision(input = {}) {
    const constraint = equipmentConstraint(input.environment, input.equipment);
    const selected = recommendationSelection(input, constraint);
    const goal = VALID_GOALS.has(input.goal) ? input.goal : "general";
    const recovery = input.recovery || {};
    const highPain = Number(recovery.pain || 0) >= 4 || input.forceRecovery === true;
    const temporaryRecovery = !highPain && (input.forceTemporaryRecovery === true || (
      (hasNumericSignal(recovery.sleepHours) && Number(recovery.sleepHours) < 6)
      || (hasNumericSignal(recovery.energy) && Number(recovery.energy) <= 2)
      || Number(recovery.soreness || 0) >= 4
    ));
    let template = selected.template;
    let selectedTemplateId = selected.templateId;
    if (highPain) {
      template = (Array.isArray(input.templates) ? input.templates : []).find(item => text(item?.id) === "beginner_recovery") || null;
      selectedTemplateId = text(template?.id);
    }
    if (!template) {
      return {
        valid: false,
        error: "MISSING_TEMPLATE",
        exercises: [],
        reasons: [],
        adjustments: [],
        decision: {
          selectedTemplateId: "",
          routineTransition: routineTransition(selected.rotation, highPain, temporaryRecovery),
          environmentConstraint: constraint,
          goalPrescription: goalPrescriptionCode(goal),
          recoveryAdjustment: "NONE",
          progressionSource: { type: "NONE", workoutId: "" },
          scheduledDateReason: "NONE",
          safetyOverride: highPain ? "HIGH_PAIN_RECOVERY_NON_DIAGNOSTIC" : "NONE",
          algorithmVersion: RECOMMENDATION_ALGORITHM_VERSION
        }
      };
    }

    const prescribed = applyGoalPrescription(template, highPain ? "recovery" : goal) || clone(template);
    const excludedExerciseNames = [];
    let candidates = (prescribed.exercises || []).filter(exercise => {
      if (template.builtIn === false) return true;
      const required = inferredExerciseEquipment(template, exercise);
      const allowed = required.every(item => constraint.allowedEquipment.includes(item));
      if (!allowed) excludedExerciseNames.push(text(exercise.name));
      return allowed;
    });
    if (!candidates.length) {
      return {
        valid: false,
        error: "EMPTY_PLAN_AFTER_EQUIPMENT_FILTER",
        exercises: [],
        reasons: [],
        adjustments: [],
        decision: {
          selectedTemplateId,
          routineTransition: routineTransition(selected.rotation, highPain, temporaryRecovery),
          environmentConstraint: { ...constraint, excludedExerciseNames },
          goalPrescription: goalPrescriptionCode(goal),
          recoveryAdjustment: "NONE",
          progressionSource: { type: "NONE", workoutId: "" },
          scheduledDateReason: "NONE",
          safetyOverride: highPain ? "HIGH_PAIN_RECOVERY_NON_DIAGNOSTIC" : "NONE",
          algorithmVersion: RECOMMENDATION_ALGORITHM_VERSION
        }
      };
    }

    const sourceWorkouts = [];
    const adjustments = [];
    const exercises = candidates.map((exercise, exerciseIndex) => {
      const latest = highPain ? null : findLatestExercisePerformance(input.workouts, exercise.name);
      if (latest?.workout) sourceWorkouts.push(latest.workout);
      const baseSets = latest?.exercise?.sets?.length ? latest.exercise.sets : exercise.sets;
      let plannedSets = enforceGoalSets(baseSets, highPain ? "recovery" : goal, exerciseIndex);
      const failures = highPain ? 0 : consecutiveExerciseFailures(input.workouts, text(exercise.name));
      const sourceRpe = Number(latest?.workout?.sessionRpe ?? latest?.exercise?.sets?.[0]?.rpe ?? 6);
      const feeling = latest?.workout?.feeling || (sourceRpe <= 5 ? "easy" : sourceRpe >= 8 ? "hard" : "right");
      let adjustment = "按当前处方稳定完成。";
      if (highPain) {
        adjustment = "本次改为低强度恢复，不推进原训练负荷。";
      } else if (temporaryRecovery && plannedSets.length > 1) {
        plannedSets = plannedSets.slice(0, -1);
        adjustment = "仅本次少做一组，原训练顺序和长期处方不变。";
      } else if (failures >= 2 && plannedSets.length > 1) {
        plannedSets = plannedSets.slice(0, -1);
        adjustment = "连续两次未达到目标，本次减少一组并保持重量。";
      } else if (failures === 1) {
        adjustment = "上次未达到目标，本次保持重量并先稳定完成，不盲目加重。";
      } else if (latest && feeling === "easy" && sourceRpe <= 5) {
        plannedSets = plannedSets.map(set => {
          const reps = Number(set.reps);
          const weight = Number(set.weight);
          if (goal === "muscle_gain" && Number.isFinite(reps) && reps < 12) return { ...set, reps: reps + 1 };
          if (goal === "fat_loss" && Number.isFinite(reps)) return { ...set, reps: reps + 1 };
          if (Number.isFinite(weight) && weight > 0) return { ...set, weight: weight + (weight >= 20 ? 2.5 : 1) };
          if (goal !== "strength" && Number.isFinite(reps)) return { ...set, reps: reps + 1 };
          return set;
        });
        adjustment = "最近一次同动作轻松达标，本次按目标小幅增加。";
      } else if (latest) {
        adjustment = "保持最近一次同动作负荷，先稳定完成。";
      } else {
        adjustment = "首次基线按模板完成，不急着加量。";
      }
      if (!adjustments.includes(adjustment)) adjustments.push(adjustment);
      return {
        id: `recommendation_exercise_${exerciseIndex + 1}`,
        name: text(exercise.name),
        metric: text(exercise.metric) || "reps",
        cue: text(exercise.cue) || text(exercise.sets?.[0]?.note),
        requiredEquipment: inferredExerciseEquipment(template, exercise),
        sets: clone(plannedSets),
        adjustment,
        reason: latest ? "负荷来自该动作最近一次真实记录。" : "该动作使用当前模板基线。",
        progressionWorkoutId: text(latest?.workout?.id)
      };
    }).filter(exercise => exercise.name && exercise.sets.length);

    if (!exercises.length || new Set(exercises.map(exercise => exercise.id)).size !== exercises.length) {
      return { valid: false, error: "INVALID_RECOMMENDATION_RESULT", exercises: [], reasons: [], adjustments: [], decision: null };
    }

    const latestSource = sourceWorkouts.slice().sort((a, b) => workoutSortKey(b).localeCompare(workoutSortKey(a)))[0] || null;
    const progressionSource = latestSource
      ? { type: "LATEST_SAME_EXERCISE", workoutId: text(latestSource.id) }
      : { type: "TEMPLATE_BASELINE", workoutId: "" };
    const recoveryAdjustment = highPain
      ? "RECOVERY_OVERRIDE"
      : goal === "recovery"
        ? "RECOVERY_GOAL_LIGHT_SESSION"
        : temporaryRecovery
          ? "TEMPORARY_VOLUME_REDUCTION"
          : "NONE";
    const dateDecision = recommendationDate(input, highPain, temporaryRecovery);
    const decision = {
      selectedTemplateId,
      routineTransition: routineTransition(selected.rotation, highPain, temporaryRecovery),
      environmentConstraint: { ...constraint, excludedExerciseNames, usedEquipment: [...new Set(exercises.flatMap(exercise => exercise.requiredEquipment))] },
      goalPrescription: goalPrescriptionCode(goal),
      recoveryAdjustment,
      progressionSource,
      scheduledDateReason: dateDecision.reason,
      safetyOverride: highPain ? "HIGH_PAIN_RECOVERY_NON_DIAGNOSTIC" : "NONE",
      algorithmVersion: RECOMMENDATION_ALGORITHM_VERSION
    };
    const reasons = [];
    if (highPain) {
      reasons.push("明显疼痛信号触发恢复优先，安全优先于负荷推进；本建议不构成医疗诊断，不适持续或加重时请咨询专业人士。");
    }
    reasons.push(`器械限制已执行：仅使用${decision.environmentConstraint.usedEquipment.join("、")}。`);
    reasons.push(goalReason(decision.goalPrescription));
    if (decision.routineTransition === "A_TO_B") reasons.push("按原训练顺序，本次轮到全身 B。");
    else if (decision.routineTransition === "B_TO_A") reasons.push("按原训练顺序，本次轮到全身 A。");
    else if (decision.routineTransition.startsWith("RECOVERY_HOLD_")) reasons.push("恢复训练不推进轮换，结束后返回原训练顺序。");
    else if (decision.routineTransition.includes("TEMPORARY_ADJUSTMENT")) reasons.push("恢复状态只调整本次训练，不永久改变原 routine。");
    if (progressionSource.type === "TEMPLATE_BASELINE") reasons.push("这是当前动作组合的首次基线，先按模板完成。");
    else reasons.push("动作负荷优先采用最近一次同动作的真实记录。");
    return {
      valid: true,
      error: "",
      template: { ...clone(template), id: selectedTemplateId, exercises: clone(exercises) },
      title: highPain ? "恢复优先训练" : selected.rotation.mode === "full_body" ? text(template.name) : text(selected.day?.label) || text(template.name),
      exercises,
      reasons,
      adjustments,
      scheduledFor: dateDecision.scheduledFor,
      estimatedDuration: Number(template.duration) || null,
      rotationDayId: text(selected.day?.id),
      decision
    };
  }

  function preserveUserPlan(existingPlan, trigger, generatedPlan) {
    if (trigger === "render" && existingPlan) return existingPlan;
    return generatedPlan;
  }

  global.TrainingRotationModel = Object.freeze({
    VERSION,
    RECOMMENDATION_ALGORITHM_VERSION,
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
    progressVisibility,
    buildRecommendationDecision,
    preserveUserPlan
  });
})(globalThis);
