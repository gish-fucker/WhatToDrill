(function attachWorkoutSessionModel(global) {
  "use strict";

  const VERSION = 5;
  const DEFAULT_REST_SECONDS = 90;
  const VALID_STATUSES = new Set(["pending", "completed", "skipped"]);
  const VALID_METRICS = new Set(["reps", "seconds", "minutes", "completion"]);
  const RECORD_TYPES = Object.freeze([
    "weighted_reps",
    "bodyweight_reps",
    "assisted_or_added_weight_reps",
    "duration_seconds",
    "duration_minutes",
    "completion_only"
  ]);
  const VALID_RECORD_TYPES = new Set(RECORD_TYPES);
  const FEELING_RPE = Object.freeze({ easy: 4, right: 6, hard: 8 });
  let idSequence = 0;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultId(prefix) {
    idSequence += 1;
    if (global.crypto?.randomUUID) return `${prefix}-${global.crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}`;
  }

  function optionalNumber(value) {
    if (value === "" || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function legacyMetricForRecordType(recordType) {
    if (recordType === "duration_seconds") return "seconds";
    if (recordType === "duration_minutes") return "minutes";
    if (recordType === "completion_only") return "completion";
    return "reps";
  }

  function inferRecordType(recordType, metric, note = "", exerciseName = "", values = {}) {
    if (VALID_RECORD_TYPES.has(recordType)) return recordType;
    if (metric === "seconds") return "duration_seconds";
    if (metric === "minutes") return "duration_minutes";
    if (metric === "completion") return "completion_only";
    const cue = `${exerciseName} ${note}`;
    if (/按秒|秒记录|平板支撑/.test(cue)) return "duration_seconds";
    if (/按分钟|分钟记录|快走|跑步/.test(cue)) return "duration_minutes";
    if (/完成即可|仅完成/.test(cue)) return "completion_only";
    if (/辅助引体|负重引体|引体向上|引体/.test(cue)) return "assisted_or_added_weight_reps";
    if (/自重深蹲|徒手深蹲|俯卧撑|椅子深蹲|分腿蹲|深蹲跳|开合跳|鸟狗|死虫|臀桥|卷腹|徒手/.test(cue)) {
      return "bodyweight_reps";
    }
    return "weighted_reps";
  }

  function inferMetric(metric, note = "", exerciseName = "") {
    if (VALID_METRICS.has(metric)) return metric;
    return legacyMetricForRecordType(inferRecordType("", metric, note, exerciseName));
  }

  function normalizeValues(values = {}, recordType = "weighted_reps") {
    const normalized = {
      weight: optionalNumber(values.weight),
      reps: optionalNumber(values.reps),
      rpe: optionalNumber(values.rpe),
      note: normalizeText(values.note)
    };
    if (["bodyweight_reps", "duration_seconds", "duration_minutes", "completion_only"].includes(recordType)) {
      normalized.weight = null;
    }
    if (recordType === "completion_only") normalized.reps = null;
    return normalized;
  }

  function emptyActual() {
    return { weight: null, reps: null, rpe: null, note: "" };
  }

  function emptyCompanion() {
    return { rest: null, transition: null };
  }

  function normalizeCompanion(companion = {}) {
    const sourceRest = companion.rest || {};
    const restStartedAt = sourceRest.restStartedAt || sourceRest.startedAt;
    const restEndsAt = sourceRest.restEndsAt || sourceRest.endsAt;
    const duration = optionalNumber(sourceRest.restDurationSeconds ?? sourceRest.durationSeconds);
    const remaining = optionalNumber(sourceRest.restRemainingWhenPaused ?? sourceRest.remainingWhenPaused);
    const rest = sourceRest.sourceSetId && restStartedAt && restEndsAt
      ? {
          sourceSetId: normalizeText(sourceRest.sourceSetId),
          nextSetId: normalizeText(sourceRest.nextSetId || companion.transition?.targetSetId),
          restStartedAt,
          restEndsAt,
          restDurationSeconds: duration && duration > 0 ? Math.round(duration) : DEFAULT_REST_SECONDS,
          restPausedAt: sourceRest.restPausedAt || sourceRest.pausedAt || null,
          restRemainingWhenPaused: remaining === null ? null : Math.max(0, Math.round(remaining))
        }
      : null;
    const transition = companion.transition?.sourceSetId && companion.transition?.targetSetId
      ? {
          sourceSetId: normalizeText(companion.transition.sourceSetId),
          targetSetId: normalizeText(companion.transition.targetSetId),
          kind: companion.transition.kind === "exercise" ? "exercise" : "set"
        }
      : null;
    return { rest, transition };
  }

  function normalizeSet(set = {}, exercise = {}, idFactory = defaultId) {
    const targetSource = set.target || set;
    const actualSource = set.actual || emptyActual();
    const recordType = inferRecordType(
      set.recordType || exercise.recordType,
      set.metric || exercise.metric,
      targetSource.note,
      exercise.name,
      { weight: targetSource.weight ?? actualSource.weight }
    );
    return {
      id: set.id || idFactory("set"),
      recordType,
      metric: legacyMetricForRecordType(recordType),
      status: VALID_STATUSES.has(set.status) ? set.status : "pending",
      restDurationSeconds: optionalNumber(set.restDurationSeconds ?? set.restSeconds),
      target: normalizeValues(targetSource, recordType),
      actual: normalizeValues(actualSource, recordType)
    };
  }

  function normalizeExercise(exercise = {}, idFactory = defaultId) {
    const firstSet = Array.isArray(exercise.sets) ? exercise.sets.find(set => set && typeof set === "object") : null;
    const recordType = inferRecordType(
      exercise.recordType,
      exercise.metric,
      firstSet?.target?.note ?? firstSet?.note,
      exercise.name,
      firstSet?.target || firstSet || {}
    );
    return {
      id: exercise.id || idFactory("exercise"),
      name: normalizeText(exercise.name) || "未命名动作",
      recordType,
      metric: legacyMetricForRecordType(recordType),
      cue: normalizeText(exercise.cue),
      restDurationSeconds: optionalNumber(exercise.restDurationSeconds ?? exercise.restSeconds),
      sets: (Array.isArray(exercise.sets) ? exercise.sets : [])
        .filter(set => set && typeof set === "object")
        .map(set => normalizeSet(set, exercise, idFactory))
    };
  }

  function flattenSets(session) {
    return session.exercises.flatMap(exercise => exercise.sets);
  }

  function firstPendingSetId(session) {
    return flattenSets(session).find(set => set.status === "pending")?.id || null;
  }

  function createSession(plan = {}, options = {}) {
    const idFactory = typeof options.idFactory === "function" ? options.idFactory : defaultId;
    const exercises = (Array.isArray(plan.exercises) ? plan.exercises : [])
      .filter(exercise => exercise && typeof exercise === "object")
      .map(exercise => normalizeExercise(exercise, idFactory));
    const session = {
      version: VERSION,
      id: plan.id || idFactory("session"),
      date: normalizeText(plan.date) || options.date || new Date().toISOString().slice(0, 10),
      title: normalizeText(plan.title) || "本次训练",
      templateId: normalizeText(plan.templateId),
      trainingGoal: normalizeText(plan.trainingGoal),
      defaultRestSeconds: optionalNumber(plan.defaultRestSeconds),
      startedAt: plan.startedAt || options.startedAt || new Date().toISOString(),
      currentSetId: plan.currentSetId || null,
      companion: normalizeCompanion(plan.companion),
      exercises
    };
    const selectedSet = flattenSets(session).find(set => set.id === session.currentSetId);
    if (!selectedSet || (selectedSet.status !== "pending" && firstPendingSetId(session))) {
      session.currentSetId = firstPendingSetId(session) || flattenSets(session)[0]?.id || null;
    }
    const source = findSet(session, session.companion.transition?.sourceSetId);
    const target = findSet(session, session.companion.transition?.targetSetId);
    const restStart = Date.parse(session.companion.rest?.restStartedAt);
    const restEnd = Date.parse(session.companion.rest?.restEndsAt);
    const companionValid = source?.set.status === "completed"
      && target?.set.status === "pending"
      && target.set.id === session.currentSetId;
    if (!companionValid) session.companion = emptyCompanion();
    else if (session.companion.rest && (
      !Number.isFinite(restStart)
      || !Number.isFinite(restEnd)
      || restEnd < restStart
      || session.companion.rest.nextSetId !== session.currentSetId
      || (session.companion.rest.restPausedAt && !Number.isFinite(Date.parse(session.companion.rest.restPausedAt)))
    )) {
      session.companion.rest = null;
    }
    return session;
  }

  function findSet(session, setId) {
    for (const exercise of session.exercises) {
      const set = exercise.sets.find(candidate => candidate.id === setId);
      if (set) return { exercise, set };
    }
    return null;
  }

  function nextPendingSetId(session, currentSetId) {
    const sets = flattenSets(session);
    if (!sets.length) return null;
    const startIndex = Math.max(sets.findIndex(set => set.id === currentSetId), -1);
    for (let offset = 1; offset <= sets.length; offset += 1) {
      const set = sets[(startIndex + offset) % sets.length];
      if (set.status === "pending") return set.id;
    }
    return null;
  }

  function updateSet(session, setId, updater) {
    const next = clone(session);
    const found = findSet(next, setId);
    if (!found) throw new Error(`Unknown workout set: ${setId}`);
    updater(found.set, found.exercise, next);
    return next;
  }

  function updateActual(session, setId, patch = {}) {
    return updateSet(session, setId, set => {
      set.actual = normalizeValues({ ...set.actual, ...patch }, set.recordType);
    });
  }

  function completeSet(session, setId, patch, options = {}) {
    if (findSet(session, setId)?.set.status !== "pending") return clone(session);
    const next = updateSet(session, setId, (set, _exercise, draft) => {
      if (patch) set.actual = normalizeValues({ ...set.actual, ...patch }, set.recordType);
      set.status = "completed";
      const targetSetId = nextPendingSetId(draft, setId);
      draft.currentSetId = targetSetId;
      draft.companion = normalizeCompanion(draft.companion);
      if (!targetSetId) {
        draft.companion = emptyCompanion();
        return;
      }
      const startedAt = options.now || new Date().toISOString();
      const startedMs = Date.parse(startedAt);
      const safeStartedAt = Number.isFinite(startedMs) ? startedAt : new Date().toISOString();
      const source = findSet(draft, setId);
      const target = findSet(draft, targetSetId);
      const requestedDuration = optionalNumber(options.restDurationSeconds);
      const restDurationSeconds = requestedDuration && requestedDuration > 0
        ? Math.round(requestedDuration)
        : DEFAULT_REST_SECONDS;
      draft.companion.rest = {
        sourceSetId: setId,
        nextSetId: targetSetId,
        restStartedAt: safeStartedAt,
        restEndsAt: new Date(Date.parse(safeStartedAt) + restDurationSeconds * 1000).toISOString(),
        restDurationSeconds,
        restPausedAt: null,
        restRemainingWhenPaused: null
      };
      draft.companion.transition = {
        sourceSetId: setId,
        targetSetId,
        kind: source?.exercise.id === target?.exercise.id ? "set" : "exercise"
      };
    });
    return next;
  }

  function skipSet(session, setId) {
    if (findSet(session, setId)?.set.status !== "pending") return clone(session);
    return updateSet(session, setId, (set, _exercise, draft) => {
      set.status = "skipped";
      draft.currentSetId = nextPendingSetId(draft, setId);
      draft.companion = emptyCompanion();
    });
  }

  function undoSet(session, setId) {
    return updateSet(session, setId, (set, _exercise, draft) => {
      set.status = "pending";
      draft.currentSetId = setId;
      draft.companion = emptyCompanion();
    });
  }

  function selectSet(session, setId) {
    const next = clone(session);
    if (!findSet(next, setId)) throw new Error(`Unknown workout set: ${setId}`);
    next.currentSetId = setId;
    next.companion = emptyCompanion();
    return next;
  }

  function remainingRestSeconds(session, now = new Date().toISOString()) {
    const rest = session.companion?.rest;
    if (rest?.restPausedAt) return Math.max(0, optionalNumber(rest.restRemainingWhenPaused) || 0);
    const end = Date.parse(rest?.restEndsAt);
    const current = Date.parse(now);
    return Number.isFinite(end) && Number.isFinite(current)
      ? Math.max(0, Math.ceil((end - current) / 1000))
      : 0;
  }

  function adjustRest(session, deltaSeconds, now = new Date().toISOString()) {
    const next = clone(session);
    next.companion = normalizeCompanion(next.companion);
    const rest = next.companion.rest;
    if (!rest) return next;
    const current = Date.parse(now);
    const delta = Number(deltaSeconds);
    if (!Number.isFinite(current) || !Number.isFinite(delta)) return next;
    if (rest.restPausedAt) {
      rest.restRemainingWhenPaused = Math.max(0, (optionalNumber(rest.restRemainingWhenPaused) || 0) + delta);
    } else {
      const end = Date.parse(rest.restEndsAt);
      if (Number.isFinite(end)) rest.restEndsAt = new Date(Math.max(end, current) + delta * 1000).toISOString();
    }
    return next;
  }

  function resetRest(session, now = new Date().toISOString()) {
    const next = clone(session);
    next.companion = normalizeCompanion(next.companion);
    if (!next.companion.rest) return next;
    const current = Date.parse(now);
    if (!Number.isFinite(current)) return next;
    const duration = next.companion.rest.restDurationSeconds || DEFAULT_REST_SECONDS;
    next.companion.rest.restStartedAt = now;
    next.companion.rest.restEndsAt = new Date(current + duration * 1000).toISOString();
    next.companion.rest.restPausedAt = null;
    next.companion.rest.restRemainingWhenPaused = null;
    return next;
  }

  function pauseRest(session, now = new Date().toISOString()) {
    const next = clone(session);
    next.companion = normalizeCompanion(next.companion);
    const rest = next.companion.rest;
    if (!rest || rest.restPausedAt) return next;
    const current = Date.parse(now);
    if (!Number.isFinite(current)) return next;
    rest.restRemainingWhenPaused = remainingRestSeconds(next, now);
    rest.restPausedAt = now;
    return next;
  }

  function resumeRest(session, now = new Date().toISOString()) {
    const next = clone(session);
    next.companion = normalizeCompanion(next.companion);
    const rest = next.companion.rest;
    if (!rest?.restPausedAt) return next;
    const current = Date.parse(now);
    if (!Number.isFinite(current)) return next;
    const remaining = Math.max(0, optionalNumber(rest.restRemainingWhenPaused) || 0);
    rest.restEndsAt = new Date(current + remaining * 1000).toISOString();
    rest.restPausedAt = null;
    rest.restRemainingWhenPaused = null;
    return next;
  }

  function isRestPaused(session) {
    return Boolean(session.companion?.rest?.restPausedAt);
  }

  function isRestLocked(session, now = new Date().toISOString()) {
    return Boolean(session.companion?.rest) && remainingRestSeconds(session, now) > 0;
  }

  function clearRest(session) {
    const next = clone(session);
    next.companion = normalizeCompanion(next.companion);
    next.companion.rest = null;
    return next;
  }

  function prefillCurrentWeight(session) {
    const next = clone(session);
    const exercise = next.exercises.find(item => item.sets.some(set => set.id === next.currentSetId));
    if (!exercise) return next;
    const currentIndex = exercise.sets.findIndex(set => set.id === next.currentSetId);
    const current = exercise.sets[currentIndex];
    if (!current || current.actual.weight !== null) return next;
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      const candidate = exercise.sets[index];
      if (candidate.status !== "completed") continue;
      const weight = candidate.actual.weight ?? candidate.target.weight;
      if (weight !== null) current.actual.weight = weight;
      break;
    }
    return next;
  }

  function progress(session) {
    const sets = flattenSets(session);
    const completed = sets.filter(set => set.status === "completed").length;
    const skipped = sets.filter(set => set.status === "skipped").length;
    const pending = sets.length - completed - skipped;
    return {
      total: sets.length,
      completed,
      skipped,
      pending,
      percent: sets.length ? Math.round((completed / sets.length) * 100) : 0
    };
  }

  function materializedResult(set) {
    const result = {
      weight: set.actual.weight ?? set.target.weight,
      reps: set.metric === "completion" ? null : set.actual.reps ?? set.target.reps,
      rpe: set.actual.rpe ?? set.target.rpe,
      note: set.actual.note,
      recordType: set.recordType,
      metric: set.metric
    };
    return result;
  }

  function completedExercises(session) {
    return session.exercises.map(exercise => ({
      name: exercise.name,
      sets: exercise.sets
        .filter(set => set.status === "completed")
        .map(materializedResult)
    })).filter(exercise => exercise.sets.length);
  }

  function canFinish(session) {
    return progress(session).completed > 0;
  }

  function feelingToRpe(feeling) {
    return FEELING_RPE[feeling] ?? null;
  }

  function elapsedMinutes(startedAt, endedAt = new Date().toISOString()) {
    const start = Date.parse(startedAt);
    const end = Date.parse(endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return Math.max(1, Math.round((end - start) / 60000));
  }

  function toWorkoutRecord(session, summary = {}) {
    const exercises = completedExercises(session);
    if (!exercises.length) throw new Error("Complete at least one set before saving.");
    const sessionRpe = optionalNumber(summary.sessionRpe) ?? feelingToRpe(summary.feeling);
    if (sessionRpe === null) throw new Error("Choose an overall workout feeling before saving.");
    return {
      date: normalizeText(summary.date) || session.date,
      title: normalizeText(summary.title) || session.title,
      duration: optionalNumber(summary.duration) ?? elapsedMinutes(session.startedAt, summary.endedAt),
      sessionRpe,
      note: normalizeText(summary.note),
      exercises
    };
  }

  function migrateDraft(draft = {}, options = {}) {
    if (draft.version === VERSION) return createSession(draft, options);
    if ([3, 4].includes(draft.version)) return createSession(draft, options);
    if (draft.version === 2) return createSession({ ...draft, companion: emptyCompanion() }, options);
    const migrated = {
      id: draft.id,
      date: draft.date,
      title: draft.title,
      templateId: draft.templateId,
      startedAt: draft.startedAt || options.startedAt,
      companion: emptyCompanion(),
      exercises: (Array.isArray(draft.exercises) ? draft.exercises : []).map(exercise => ({
        name: exercise.name,
        recordType: exercise.recordType,
        metric: exercise.metric,
        sets: (Array.isArray(exercise.sets) ? exercise.sets : []).map(set => ({
          recordType: set.recordType || exercise.recordType,
          metric: set.metric,
          status: optionalNumber(set.weight) !== null ? "completed" : "pending",
          target: normalizeValues(set, inferRecordType(set.recordType || exercise.recordType, set.metric || exercise.metric, set.note, exercise.name, set)),
          actual: normalizeValues(set, inferRecordType(set.recordType || exercise.recordType, set.metric || exercise.metric, set.note, exercise.name, set))
        }))
      }))
    };
    return createSession(migrated, options);
  }

  global.WorkoutSessionModel = Object.freeze({
    VERSION,
    DEFAULT_REST_SECONDS,
    RECORD_TYPES,
    VALID_METRICS: Object.freeze(Array.from(VALID_METRICS)),
    createSession,
    migrateDraft,
    inferMetric,
    inferRecordType,
    legacyMetricForRecordType,
    updateActual,
    completeSet,
    skipSet,
    undoSet,
    selectSet,
    progress,
    completedExercises,
    canFinish,
    feelingToRpe,
    elapsedMinutes,
    remainingRestSeconds,
    adjustRest,
    resetRest,
    pauseRest,
    resumeRest,
    isRestPaused,
    isRestLocked,
    clearRest,
    prefillCurrentWeight,
    toWorkoutRecord
  });
})(globalThis);
