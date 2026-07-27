import assert from "node:assert/strict";
import "../public/workout-session-model.js";
import "../public/workout-session-controller.js";

const model = globalThis.WorkoutSessionModel;
const controllerModel = globalThis.WorkoutSessionController;

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values
  };
}

const changes = [];
const storage = memoryStorage();
let id = 0;
const controller = controllerModel.create({
  model,
  storage,
  storageKey: "draft",
  now: () => "2026-07-27T10:00:00.000Z",
  onChange: (session, detail) => changes.push({ session, detail })
});

const started = controller.start({
  date: "2026-07-27",
  title: "控制器训练",
  exercises: [
    { name: "深蹲", recordType: "weighted_reps", sets: [{ weight: 20, reps: 8 }] },
    { name: "平板支撑", recordType: "duration_seconds", sets: [{ reps: 30 }] }
  ]
}, {
  modelOptions: { idFactory: prefix => `${prefix}-${++id}`, startedAt: "2026-07-27T09:00:00.000Z" },
  metadata: { rotationDayId: "rotation-a", sourceTemplateId: "template-a", nextPlanId: "plan-b" }
});
assert.equal(started.rotationDayId, "rotation-a");
assert.equal(started.sourceTemplateId, "template-a");
assert.equal(JSON.parse(storage.values.get("draft")).version, model.VERSION);

const firstSetId = started.exercises[0].sets[0].id;
controller.updateActual(firstSetId, { reps: 10 });
const completed = controller.complete(firstSetId, { reps: 10 }, {
  now: "2026-07-27T09:05:00.000Z",
  restDurationSeconds: 75
});
assert.equal(completed.exercises[0].sets[0].status, "completed");
assert.equal(model.isRestLocked(completed, "2026-07-27T09:05:30.000Z"), true);
controller.pauseRest("2026-07-27T09:05:30.000Z");
assert.equal(model.isRestPaused(controller.snapshot()), true);
controller.resumeRest("2026-07-27T09:06:00.000Z");
controller.adjustRest(30, "2026-07-27T09:06:00.000Z");
controller.clearRest();
assert.equal(controller.snapshot().companion.rest, null);

const secondSetId = controller.snapshot().exercises[1].sets[0].id;
assert.equal(controller.skip(secondSetId).exercises[1].sets[0].status, "skipped");
assert.equal(controller.undo(secondSetId).exercises[1].sets[0].status, "pending");
assert.equal(controller.select(secondSetId).currentSetId, secondSetId);
assert(changes.some(change => change.detail.reason === "complete" && change.detail.persisted));

const restoredStorage = memoryStorage({ draft: storage.values.get("draft") });
const restoredController = controllerModel.create({ model, storage: restoredStorage, storageKey: "draft" });
const restored = restoredController.restore();
assert.equal(restored.version, model.VERSION);
assert.equal(restored.sourceTemplateId, "template-a");
assert.equal(restored.currentSetId, secondSetId);

const stateBeforeClear = controller.snapshot();
assert(stateBeforeClear);
assert.equal(controller.clear(), true);
assert.equal(controller.snapshot(), null);
assert.equal(storage.values.has("draft"), false);

const errors = [];
const failingStorage = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
  removeItem() { throw new Error("blocked"); }
};
const degraded = controllerModel.create({ model, storage: failingStorage, storageKey: "draft", onError: error => errors.push(error.message) });
assert.doesNotThrow(() => degraded.start({ date: "2026-07-27", title: "仍可训练", exercises: [{ name: "深蹲", sets: [{}] }] }));
assert(degraded.snapshot(), "Storage failure must not block the in-memory session.");
assert.equal(errors.length, 1);
assert.equal(degraded.clear(), false);

console.log("Workout session controller tests passed.");
