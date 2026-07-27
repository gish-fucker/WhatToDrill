(function attachLocalBetaFunnelModel(global) {
  "use strict";

  const SCHEMA_VERSION = 1;
  const DEFAULT_CAPACITY = 1000;
  const EVENTS_KEY = "whatToDrillLocalBetaEventsV1";
  const META_KEY = "whatToDrillLocalBetaMetaV1";
  const EVENT_NAMES = Object.freeze([
    "onboarding_completed",
    "workout_started",
    "first_set_completed",
    "workout_completed",
    "next_plan_generated",
    "next_plan_modified",
    "next_plan_accepted",
    "returned_workout_started",
    "workout_abandoned",
    "recommendation_feedback"
  ]);
  const VALID_EVENTS = new Set(EVENT_NAMES);
  const VALID_ENVIRONMENTS = new Set(["", "gym", "home_bodyweight", "home_dumbbell", "mixed"]);
  const VALID_GOALS = new Set(["", "general", "fat_loss", "muscle_gain", "strength", "recovery"]);
  const FEEDBACK_VALUES = Object.freeze(["helpful", "too_easy", "too_hard", "not_for_me"]);
  const VALID_FEEDBACK = new Set(FEEDBACK_VALUES);

  function boundedText(value, maxLength = 120) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  }

  function safeParse(raw, fallback) {
    try {
      const parsed = JSON.parse(raw || "null");
      return parsed === null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function defaultId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return `installation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function normalizeEvent(candidate) {
    if (!candidate || !VALID_EVENTS.has(candidate.name)) return null;
    const event = {
      installationId: boundedText(candidate.installationId),
      name: candidate.name,
      timestamp: Number.isFinite(Date.parse(candidate.timestamp)) ? new Date(candidate.timestamp).toISOString() : "",
      appVersion: boundedText(candidate.appVersion, 40),
      algorithmVersion: boundedText(candidate.algorithmVersion, 80),
      templateId: boundedText(candidate.templateId),
      environment: VALID_ENVIRONMENTS.has(candidate.environment) ? candidate.environment : "",
      goal: VALID_GOALS.has(candidate.goal) ? candidate.goal : ""
    };
    if (!event.installationId || !event.timestamp) return null;
    if (candidate.name === "recommendation_feedback" && VALID_FEEDBACK.has(candidate.feedback)) {
      event.feedback = candidate.feedback;
    }
    return event;
  }

  function summarize(events = []) {
    const normalized = (Array.isArray(events) ? events : []).map(normalizeEvent).filter(Boolean);
    const feedback = Object.fromEntries(FEEDBACK_VALUES.map(value => [value, 0]));
    normalized.filter(event => event.name === "recommendation_feedback").forEach(event => {
      if (event.feedback in feedback) feedback[event.feedback] += 1;
    });
    return {
      firstWorkoutStarted: Number(normalized.some(event => event.name === "workout_started")),
      firstWorkoutCompleted: Number(normalized.some(event => event.name === "workout_completed")),
      nextPlanAccepted: Number(normalized.some(event => event.name === "next_plan_accepted")),
      secondWorkoutStarted: Number(normalized.some(event => event.name === "returned_workout_started")),
      secondWorkoutCompleted: Number(normalized.filter(event => event.name === "workout_completed").length >= 2),
      recommendationFeedback: feedback
    };
  }

  function create(options = {}) {
    const storage = options.storage || global.localStorage;
    const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
    const idFactory = typeof options.idFactory === "function" ? options.idFactory : defaultId;
    const capacity = Number.isInteger(options.capacity) && options.capacity > 0 ? options.capacity : DEFAULT_CAPACITY;
    const appVersion = boundedText(options.appVersion, 40);
    const algorithmVersion = boundedText(options.algorithmVersion, 80);

    function readEvents() {
      try {
        const parsed = safeParse(storage.getItem(EVENTS_KEY), []);
        return (Array.isArray(parsed) ? parsed : []).map(normalizeEvent).filter(Boolean).slice(-capacity);
      } catch {
        return [];
      }
    }

    function readMeta() {
      try {
        const parsed = safeParse(storage.getItem(META_KEY), {});
        return {
          installationId: boundedText(parsed.installationId) || boundedText(idFactory()),
          dedupeKeys: Array.isArray(parsed.dedupeKeys) ? parsed.dedupeKeys.map(key => boundedText(key, 180)).filter(Boolean).slice(-capacity * 2) : []
        };
      } catch {
        return { installationId: boundedText(idFactory()), dedupeKeys: [] };
      }
    }

    function record(name, context = {}, dedupeKey = "") {
      try {
        if (!VALID_EVENTS.has(name)) return null;
        const meta = readMeta();
        const key = boundedText(dedupeKey, 180);
        if (key && meta.dedupeKeys.includes(key)) return null;
        const candidate = normalizeEvent({
          installationId: meta.installationId,
          name,
          timestamp: now(),
          appVersion,
          algorithmVersion,
          templateId: context.templateId,
          environment: context.environment,
          goal: context.goal,
          feedback: context.feedback
        });
        if (!candidate) return null;
        const events = [...readEvents(), candidate].slice(-capacity);
        const nextMeta = {
          installationId: meta.installationId,
          dedupeKeys: key ? [...meta.dedupeKeys, key].slice(-capacity * 2) : meta.dedupeKeys
        };
        storage.setItem(EVENTS_KEY, JSON.stringify(events));
        storage.setItem(META_KEY, JSON.stringify(nextMeta));
        return candidate;
      } catch {
        return null;
      }
    }

    function clear() {
      try {
        storage.removeItem(EVENTS_KEY);
        storage.removeItem(META_KEY);
        return true;
      } catch {
        return false;
      }
    }

    function exportPayload() {
      const events = readEvents();
      return {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: now(),
        events,
        summary: summarize(events)
      };
    }

    return Object.freeze({ record, list: readEvents, clear, exportPayload });
  }

  global.LocalBetaFunnelModel = Object.freeze({
    SCHEMA_VERSION,
    DEFAULT_CAPACITY,
    EVENTS_KEY,
    META_KEY,
    EVENT_NAMES,
    FEEDBACK_VALUES,
    create,
    summarize
  });
})(globalThis);
