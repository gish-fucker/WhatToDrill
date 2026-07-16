(function attachWorkoutSessionModel(global) {
  "use strict";

  const VERSION = 3;
  const DEFAULT_REST_SECONDS = 90;
  const VALID_STATUSES = new Set(["pending", "completed", "skipped"]);
  const VALID_METRICS = new Set(["reps", "seconds", "minutes", "completion"]);
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

  function inferMetric(metric, note = "", exerciseName = "") {
    if (VALID_METRICS.has(metric)) return metric;
    const cue = `${exerciseName} ${note}`;
    if (/按秒|秒记录|平板支撑/.test(cue)) return "seconds";
    if (/按分钟|分钟记录|快走/.test(cue)) return "minutes";
    if (/完成即可|仅完成/.test(cue)) return "completion";
    return "reps";
  }

  function normalizeValues(values = {}) {
    return {
      weight: optionalNumber(values.weight),
      reps: optionalNumber(values.reps),
      rpe: optionalNumber(values.rpe),
      note: normalizeText(values.note)
    };
  }

  function emptyActual() {
    return { weight: null, reps: null, rpe: null, note: "" };
  }

  function emptyCompanion() {
    return { rest: null, transition: null };
  }

  function normalizeCompanion(companion = {}) {
    const rest = companion.rest?.sourceSetId && companion.rest?.startedAt && companion.rest?.endsAt
      ? {
          sourceSetId: normalizeText(companion.rest.sourceSetId),
          startedAt: companion.rest.startedAt,
          endsAt: companion.rest.endsAt
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
    return {
      id: set.id || idFactory("set"),
      metric: inferMetric(set.metric || exercise.metric, targetSource.note, exercise.name),
      status: VALID_STATUSES.has(set.status) ? set.status : "pending",
      target: normalizeValues(targetSource),
      actual: normalizeValues(actualSource)
    };
  }

  function normalizeExercise(exercise = {}, idFactory = defaultId) {
    return {
      id: exercise.id || idFactory("exercise"),
      name: normalizeText(exercise.name) || "未命名动作",
      cue: normalizeText(exercise.cue),
      sets: (Array.isArray(exercise.sets) ? exercise.sets : [])
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
      .map(exercise => normalizeExercise(exercise, idFactory));
    const session = {
      version: VERSION,
      id: plan.id || idFactory("session"),
      date: normalizeText(plan.date) || options.date || new Date().toISOString().slice(0, 10),
      title: normalizeText(plan.title) || "本次训练",
      templateId: normalizeText(plan.templateId),
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
    const restStart = Date.parse(session.companion.rest?.startedAt);
    const restEnd = Date.parse(session.companion.rest?.endsAt);
    const companionValid = source?.set.status === "completed"
      && target?.set.status === "pending"
      && target.set.id === session.currentSetId;
    if (!companionValid) session.companion = emptyCompanion();
    else if (session.companion.rest && (!Number.isFinite(restStart) || !Number.isFinite(restEnd) || restEnd < restStart)) {
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
      set.actual = normalizeValues({ ...set.actual, ...patch });
    });
  }

  function completeSet(session, setId, patch, options = {}) {
    if (findSet(session, setId)?.set.status !== "pending") return clone(session);
    const next = updateSet(session, setId, (set, _exercise, draft) => {
      if (patch) set.actual = normalizeValues({ ...set.actual, ...patch });
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
      draft.companion.rest = {
        sourceSetId: setId,
        startedAt: safeStartedAt,
        endsAt: new Date(Date.parse(safeStartedAt) + DEFAULT_REST_SECONDS * 1000).toISOString()
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
    const end = Date.parse(session.companion?.rest?.endsAt);
    const current = Date.parse(now);
    return Number.isFinite(end) && Number.isFinite(current)
      ? Math.max(0, Math.ceil((end - current) / 1000))
      : 0;
  }

  function adjustRest(session, deltaSeconds, now = new Date().toISOString()) {
    const next = clone(session);
    next.companion = normalizeCompanion(next.companion);
    const end = Date.parse(next.companion.rest?.endsAt);
    const current = Date.parse(now);
    const delta = Number(deltaSeconds);
    if (Number.isFinite(end) && Number.isFinite(current) && Number.isFinite(delta)) {
      next.companion.rest.endsAt = new Date(Math.max(end, current) + delta * 1000).toISOString();
    }
    return next;
  }

  function resetRest(session, now = new Date().toISOString()) {
    const next = clone(session);
    next.companion = normalizeCompanion(next.companion);
    if (!next.companion.rest) return next;
    const current = Date.parse(now);
    if (!Number.isFinite(current)) return next;
    next.companion.rest.startedAt = now;
    next.companion.rest.endsAt = new Date(current + DEFAULT_REST_SECONDS * 1000).toISOString();
    return next;
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
        metric: exercise.metric,
        sets: (Array.isArray(exercise.sets) ? exercise.sets : []).map(set => ({
          metric: set.metric,
          status: optionalNumber(set.weight) !== null ? "completed" : "pending",
          target: normalizeValues(set),
          actual: normalizeValues(set)
        }))
      }))
    };
    return createSession(migrated, options);
  }

  global.WorkoutSessionModel = Object.freeze({
    VERSION,
    DEFAULT_REST_SECONDS,
    VALID_METRICS: Object.freeze(Array.from(VALID_METRICS)),
    createSession,
    migrateDraft,
    inferMetric,
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
    clearRest,
    prefillCurrentWeight,
    toWorkoutRecord
  });
})(globalThis);
