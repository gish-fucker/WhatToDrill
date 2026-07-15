import assert from "node:assert/strict";
import "../public/workout-session-model.js";

const model = globalThis.WorkoutSessionModel;
let id = 0;
const idFactory = prefix => `${prefix}-${++id}`;
const startedAt = "2026-07-15T08:00:00.000Z";

function createPlan() {
  return model.createSession({
    date: "2026-07-15",
    title: "全身入门",
    exercises: [
      { name: "深蹲", sets: [{ weight: null, reps: 12, rpe: 6, note: "动作稳定" }] },
      { name: "平板支撑", metric: "seconds", sets: [{ weight: null, reps: 30, rpe: 6 }] },
      { name: "快走", metric: "minutes", sets: [{ weight: null, reps: 10, rpe: 3 }] },
      { name: "放松", metric: "completion", sets: [{ weight: null, reps: null, rpe: 2 }] }
    ]
  }, { idFactory, startedAt });
}

assert.ok(model, "Workout session model should attach to globalThis.");
assert.equal(model.inferMetric(null, "按秒记录在次数里", "平板支撑"), "seconds");
assert.equal(model.inferMetric(null, "按分钟记录在次数里", "快走"), "minutes");

const initial = createPlan();
assert.equal(initial.version, 2, "New sessions should use the explicit-state schema.");
assert.deepEqual(model.progress(initial), { total: 4, completed: 0, skipped: 0, pending: 4, percent: 0 });
assert.equal(model.canFinish(initial), false, "A session with no completed set cannot finish.");

const squatId = initial.exercises[0].sets[0].id;
const plankId = initial.exercises[1].sets[0].id;
const walkId = initial.exercises[2].sets[0].id;
const cooldownId = initial.exercises[3].sets[0].id;

const typedOnly = model.updateActual(initial, squatId, { reps: 10 });
assert.equal(typedOnly.exercises[0].sets[0].status, "pending", "Editing a result must not imply completion.");
assert.deepEqual(model.completedExercises(typedOnly), [], "Pending input must not enter a formal record.");

const completedDefault = model.completeSet(initial, squatId);
assert.equal(completedDefault.exercises[0].sets[0].status, "completed");
assert.equal(completedDefault.currentSetId, plankId, "Completing a set should advance to the next pending set.");
assert.deepEqual(model.completedExercises(completedDefault)[0].sets[0], {
  weight: null,
  reps: 12,
  rpe: 6,
  note: "",
  metric: "reps"
}, "Unchanged template targets should materialize as the completed result.");

const timed = model.completeSet(completedDefault, plankId);
const walked = model.completeSet(timed, walkId);
const cooledDown = model.completeSet(walked, cooldownId);
const completedSets = model.completedExercises(cooledDown).flatMap(exercise => exercise.sets);
assert.equal(completedSets[1].metric, "seconds");
assert.equal(completedSets[1].reps, 30, "Timed bodyweight sets should save without weight.");
assert.equal(completedSets[2].metric, "minutes");
assert.equal(completedSets[2].reps, 10, "Minute-based sets should preserve their duration value.");
assert.equal(completedSets[3].metric, "completion");
assert.equal(completedSets[3].reps, null, "Completion-only sets should not invent repetitions.");

const skipped = model.skipSet(initial, squatId);
assert.equal(skipped.exercises[0].sets[0].status, "skipped");
assert.deepEqual(model.completedExercises(skipped), [], "Skipped sets must not enter a formal record.");

const undone = model.undoSet(completedDefault, squatId);
assert.equal(undone.exercises[0].sets[0].status, "pending");
assert.equal(undone.currentSetId, squatId, "Undo should return focus to the reverted set.");

const selected = model.selectSet(initial, walkId);
assert.equal(selected.currentSetId, walkId, "Users should be able to jump within the plan.");

assert.equal(model.feelingToRpe("easy"), 4);
assert.equal(model.feelingToRpe("right"), 6);
assert.equal(model.feelingToRpe("hard"), 8);
assert.equal(model.feelingToRpe(""), null, "Overall feeling must not be preselected.");
assert.equal(model.elapsedMinutes(startedAt, "2026-07-15T08:32:00.000Z"), 32);

assert.throws(() => model.toWorkoutRecord(initial, { feeling: "right" }), /Complete at least one set/);
assert.throws(() => model.toWorkoutRecord(completedDefault, {}), /Choose an overall workout feeling/);
const record = model.toWorkoutRecord(completedDefault, {
  feeling: "right",
  endedAt: "2026-07-15T08:32:00.000Z"
});
assert.equal(record.duration, 32);
assert.equal(record.sessionRpe, 6);
assert.equal(record.exercises[0].sets[0].reps, 12);

const legacy = model.migrateDraft({
  date: "2026-07-15",
  title: "旧草稿",
  exercises: [{
    name: "旧动作",
    sets: [
      { weight: 20, reps: 8, rpe: 7, note: "" },
      { weight: null, reps: 12, rpe: 6, note: "可能是模板值" }
    ]
  }]
}, { idFactory, startedAt });
assert.equal(legacy.version, 2);
assert.equal(legacy.exercises[0].sets[0].status, "completed", "Legacy weight is strong evidence of completion.");
assert.equal(legacy.exercises[0].sets[1].status, "pending", "Ambiguous legacy values must remain pending.");
assert.equal(legacy.exercises[0].sets[1].actual.reps, 12, "Legacy input should remain visible after migration.");

console.log("Workout session model tests passed.");
