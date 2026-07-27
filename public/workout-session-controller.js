(function attachWorkoutSessionController(global) {
  "use strict";

  const METADATA_FIELDS = Object.freeze(["rotationDayId", "sourceTemplateId", "nextPlanId"]);

  function clone(value) {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function create(options = {}) {
    const model = options.model || global.WorkoutSessionModel;
    const storage = options.storage || global.localStorage;
    const storageKey = String(options.storageKey || "");
    const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
    const onChange = typeof options.onChange === "function" ? options.onChange : () => {};
    const onError = typeof options.onError === "function" ? options.onError : () => {};
    let current = null;

    if (!model || !storage || !storageKey) throw new Error("Workout session controller requires model, storage, and storageKey.");

    function reportError(error, operation) {
      try {
        onError(error, { operation });
      } catch {
        // Error reporting must never block an in-memory workout.
      }
    }

    function notify(reason, persisted) {
      try {
        onChange(clone(current), { reason, persisted });
      } catch (error) {
        reportError(error, "notify");
      }
    }

    function snapshot() {
      return clone(current);
    }

    function persist() {
      if (!current) return false;
      try {
        storage.setItem(storageKey, JSON.stringify({ ...current, savedAt: now() }));
        return true;
      } catch (error) {
        reportError(error, "persist");
        return false;
      }
    }

    function commit(session, reason, commitOptions = {}) {
      current = session ? clone(session) : null;
      const persisted = commitOptions.persist === false ? true : persist();
      notify(reason, persisted);
      return snapshot();
    }

    function replace(session, replaceOptions = {}) {
      return commit(session, replaceOptions.reason || "replace", replaceOptions);
    }

    function start(input, startOptions = {}) {
      const session = model.createSession(input, startOptions.modelOptions || {});
      const metadata = startOptions.metadata || {};
      METADATA_FIELDS.forEach(field => {
        session[field] = typeof metadata[field] === "string" ? metadata[field] : "";
      });
      return commit(session, "start", startOptions);
    }

    function restore(restoreOptions = {}) {
      let raw;
      try {
        raw = storage.getItem(storageKey);
      } catch (error) {
        reportError(error, "restore-read");
        return null;
      }
      if (!raw) return null;
      let draft;
      try {
        draft = JSON.parse(raw);
      } catch (error) {
        reportError(error, "restore-parse");
        try {
          storage.removeItem(storageKey);
        } catch (removeError) {
          reportError(removeError, "restore-remove-invalid");
        }
        return null;
      }
      const minimumVersion = Number.isInteger(restoreOptions.minimumVersion) ? restoreOptions.minimumVersion : 2;
      if (!Number.isInteger(draft?.version) || draft.version < minimumVersion) return null;
      try {
        const session = model.migrateDraft(draft, restoreOptions.modelOptions || {});
        METADATA_FIELDS.forEach(field => {
          session[field] = typeof draft[field] === "string"
            ? draft[field]
            : field === "sourceTemplateId" ? session.templateId || "" : "";
        });
        return commit(session, "restore", { persist: false });
      } catch (error) {
        reportError(error, "restore-migrate");
        return null;
      }
    }

    function requireCurrent() {
      return current ? clone(current) : null;
    }

    function updateActual(setId, patch, updateOptions = {}) {
      const session = requireCurrent();
      if (!session) return null;
      const next = model.updateActual(session, setId, patch);
      if (updateOptions.clearTransition && !next.companion?.rest && next.companion?.transition) {
        next.companion.transition = null;
      }
      return commit(next, "update_actual", updateOptions);
    }

    function complete(setId, patch, completeOptions = {}) {
      const session = requireCurrent();
      if (!session) return null;
      let next = model.completeSet(session, setId, patch, completeOptions);
      if (completeOptions.prefillWeight !== false) next = model.prefillCurrentWeight(next);
      return commit(next, "complete", completeOptions);
    }

    function skip(setId, skipOptions = {}) {
      const session = requireCurrent();
      if (!session) return null;
      let next = model.skipSet(session, setId);
      if (skipOptions.prefillWeight !== false) next = model.prefillCurrentWeight(next);
      return commit(next, "skip", skipOptions);
    }

    function undo(setId, undoOptions = {}) {
      const session = requireCurrent();
      return session ? commit(model.undoSet(session, setId), "undo", undoOptions) : null;
    }

    function select(setId, selectOptions = {}) {
      const session = requireCurrent();
      if (!session) return null;
      const next = model.prefillCurrentWeight(model.selectSet(session, setId));
      return commit(next, "select", selectOptions);
    }

    function adjustRest(deltaSeconds, at = now(), restOptions = {}) {
      const session = requireCurrent();
      return session ? commit(model.adjustRest(session, deltaSeconds, at), "adjust_rest", restOptions) : null;
    }

    function resetRest(at = now(), restOptions = {}) {
      const session = requireCurrent();
      return session ? commit(model.resetRest(session, at), "reset_rest", restOptions) : null;
    }

    function pauseRest(at = now(), restOptions = {}) {
      const session = requireCurrent();
      return session ? commit(model.pauseRest(session, at), "pause_rest", restOptions) : null;
    }

    function resumeRest(at = now(), restOptions = {}) {
      const session = requireCurrent();
      return session ? commit(model.resumeRest(session, at), "resume_rest", restOptions) : null;
    }

    function clearRest(restOptions = {}) {
      const session = requireCurrent();
      return session ? commit(model.clearRest(session), "clear_rest", restOptions) : null;
    }

    function clear() {
      current = null;
      let removed = true;
      try {
        storage.removeItem(storageKey);
      } catch (error) {
        removed = false;
        reportError(error, "clear");
      }
      notify("clear", removed);
      return removed;
    }

    return Object.freeze({
      snapshot,
      persist,
      replace,
      start,
      restore,
      updateActual,
      complete,
      skip,
      undo,
      select,
      adjustRest,
      resetRest,
      pauseRest,
      resumeRest,
      clearRest,
      clear
    });
  }

  global.WorkoutSessionController = Object.freeze({ create });
})(globalThis);
