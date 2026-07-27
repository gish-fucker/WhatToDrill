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
assert.deepEqual(model.RECORD_TYPES, [
  "weighted_reps",
  "bodyweight_reps",
  "assisted_or_added_weight_reps",
  "duration_seconds",
  "duration_minutes",
  "completion_only"
]);
assert.equal(model.inferRecordType("", "seconds", "", "平板支撑", {}), "duration_seconds");
assert.equal(model.inferRecordType("", "reps", "", "普通俯卧撑", {}), "bodyweight_reps");
assert.equal(model.inferRecordType("", "reps", "", "引体向上", { weight: -20 }), "assisted_or_added_weight_reps");
assert.equal(model.inferRecordType("", "reps", "", "我的自定义动作", {}), "weighted_reps");
assert.equal(model.inferMetric(null, "按秒记录在次数里", "平板支撑"), "seconds");
assert.equal(model.inferMetric(null, "按分钟记录在次数里", "快走"), "minutes");

const initial = createPlan();
assert.equal(initial.version, 5, "New sessions should use the typed-record schema.");
assert.deepEqual(initial.companion, { rest: null, transition: null });
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
  recordType: "weighted_reps",
  metric: "reps"
}, "Unchanged template targets should materialize as the completed result.");

const timed = model.completeSet(completedDefault, plankId);
const walked = model.completeSet(timed, walkId);
const cooledDown = model.completeSet(walked, cooldownId);
const completedSets = model.completedExercises(cooledDown).flatMap(exercise => exercise.sets);
assert.equal(completedSets[1].metric, "seconds");
assert.equal(completedSets[1].recordType, "duration_seconds");
assert.equal(completedSets[1].reps, 30, "Timed bodyweight sets should save without weight.");
assert.equal(completedSets[2].metric, "minutes");
assert.equal(completedSets[2].recordType, "duration_minutes");
assert.equal(completedSets[2].reps, 10, "Minute-based sets should preserve their duration value.");
assert.equal(completedSets[3].metric, "completion");
assert.equal(completedSets[3].recordType, "completion_only");
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
assert.equal(legacy.version, 5);
assert.equal(legacy.exercises[0].sets[0].status, "completed", "Legacy weight is strong evidence of completion.");
assert.equal(legacy.exercises[0].sets[1].status, "pending", "Ambiguous legacy values must remain pending.");
assert.equal(legacy.exercises[0].sets[1].actual.reps, 12, "Legacy input should remain visible after migration.");

const companionNow = "2026-07-16T10:00:00.000Z";
let companion = model.createSession({
  title: "高频工具测试",
  exercises: [
    { name: "卧推", sets: [
      { target: { weight: 40, reps: 8 } },
      { target: { weight: 40, reps: 8 } }
    ] },
    { name: "坐姿划船", sets: [
      { target: { weight: 35, reps: 10 } }
    ] }
  ]
}, { idFactory, startedAt: companionNow });
const companionFirst = companion.exercises[0].sets[0].id;
const companionSecond = companion.exercises[0].sets[1].id;
const companionThird = companion.exercises[1].sets[0].id;
companion = model.completeSet(companion, companionFirst, { weight: 42.5, reps: 8 }, { now: companionNow });
assert.equal(companion.companion.transition.kind, "set");
assert.equal(companion.companion.transition.targetSetId, companionSecond);
assert.equal(companion.companion.rest.nextSetId, companionSecond);
assert.equal(companion.companion.rest.restDurationSeconds, 90);
assert.equal(model.remainingRestSeconds(companion, "2026-07-16T10:00:30.000Z"), 60);
assert.equal(model.isRestLocked(companion, "2026-07-16T10:00:30.000Z"), true);
assert.equal(model.isRestLocked(companion, "2026-07-16T10:02:00.000Z"), false);
companion = model.prefillCurrentWeight(companion);
assert.equal(companion.exercises[0].sets[1].actual.weight, 42.5, "The next set should reuse the nearest completed weight in the same exercise.");
const extended = model.adjustRest(companion, 30, "2026-07-16T10:00:30.000Z");
assert.equal(model.remainingRestSeconds(extended, "2026-07-16T10:00:30.000Z"), 90);
const reset = model.resetRest(extended, "2026-07-16T10:01:00.000Z");
assert.equal(model.remainingRestSeconds(reset, "2026-07-16T10:01:00.000Z"), 90);
const paused = model.pauseRest(reset, "2026-07-16T10:01:20.000Z");
assert.equal(model.isRestPaused(paused), true);
assert.equal(model.remainingRestSeconds(paused, "2026-07-16T12:00:00.000Z"), 70, "Paused rest must survive elapsed wall time.");
const pausedExtended = model.adjustRest(paused, 30, "2026-07-16T12:00:00.000Z");
assert.equal(model.remainingRestSeconds(pausedExtended, "2026-07-16T13:00:00.000Z"), 100);
const resumed = model.resumeRest(pausedExtended, "2026-07-16T14:00:00.000Z");
assert.equal(model.isRestPaused(resumed), false);
assert.equal(model.remainingRestSeconds(resumed, "2026-07-16T14:00:30.000Z"), 70, "Resume must recalibrate from its timestamp.");
assert.equal(model.clearRest(reset).companion.rest, null);
const revived = model.adjustRest(companion, 30, "2026-07-16T10:02:00.000Z");
assert.equal(model.remainingRestSeconds(revived, "2026-07-16T10:02:00.000Z"), 30, "Adding time after expiry should start from now.");

const movedExercise = model.completeSet(companion, companionSecond, { weight: 45, reps: 8 }, { now: "2026-07-16T10:02:00.000Z" });
assert.equal(movedExercise.currentSetId, companionThird);
assert.equal(movedExercise.companion.transition.kind, "exercise", "The final set of an exercise should announce the next exercise.");
assert.equal(model.prefillCurrentWeight(movedExercise).exercises[1].sets[0].actual.weight, null, "Weights must not carry across exercises.");
const existingActual = model.updateActual(companion, companionSecond, { weight: 47.5 });
assert.equal(model.prefillCurrentWeight(existingActual).exercises[0].sets[1].actual.weight, 47.5, "Weight inheritance must not overwrite an existing actual value.");
let skippedWeight = model.createSession({ exercises: [{ name: "硬拉", sets: [
  { target: { weight: 60, reps: 5 } }, { target: { weight: 65, reps: 5 } }
] }] }, { idFactory, startedAt: companionNow });
skippedWeight = model.skipSet(model.updateActual(skippedWeight, skippedWeight.exercises[0].sets[0].id, { weight: 70 }), skippedWeight.exercises[0].sets[0].id);
assert.equal(model.prefillCurrentWeight(skippedWeight).exercises[0].sets[1].actual.weight, null, "Skipped sets must not supply inherited weight.");
const finishedCompanion = model.completeSet(movedExercise, companionThird, { weight: 35, reps: 10 }, { now: "2026-07-16T10:04:00.000Z" });
assert.equal(finishedCompanion.companion.rest, null, "The final pending set should not start rest.");
assert.equal(finishedCompanion.companion.transition, null);

const strengthSession = model.createSession({ exercises: [{ name: "硬拉", sets: [{ reps: 5 }, { reps: 5 }] }] }, { idFactory, startedAt: companionNow });
const strengthRest = model.completeSet(strengthSession, strengthSession.currentSetId, null, { now: companionNow, restDurationSeconds: 180 });
assert.equal(strengthRest.companion.rest.restDurationSeconds, 180, "Callers must be able to apply goal/template rest overrides.");
assert.equal(model.remainingRestSeconds(strengthRest, "2026-07-16T10:01:00.000Z"), 120);

const undoneCompanion = model.undoSet(companion, companionFirst);
assert.equal(undoneCompanion.companion.rest, null, "Undoing the source set should clear its rest timer.");
assert.equal(undoneCompanion.companion.transition, null);
const manuallySelected = model.selectSet(companion, companionThird);
assert.equal(manuallySelected.companion.transition, null, "Manual selection should clear stale transition context.");
assert.deepEqual(model.completeSet(completedDefault, squatId, {}), completedDefault, "Repeating completion must be idempotent.");
assert.deepEqual(model.skipSet(skipped, squatId), skipped, "Repeating skip must be idempotent.");

const v2Draft = model.migrateDraft({ ...companion, version: 2, companion: undefined }, { idFactory, startedAt: companionNow });
assert.equal(v2Draft.version, 5);
assert.deepEqual(v2Draft.companion, { rest: null, transition: null });
const corruptCompanion = model.createSession({
  ...companion,
  companion: { rest: { sourceSetId: "missing", startedAt: "bad", endsAt: "bad" }, transition: { sourceSetId: "missing", targetSetId: companionThird, kind: "exercise" } }
}, { idFactory, startedAt: companionNow });
assert.deepEqual(corruptCompanion.companion, { rest: null, transition: null }, "Invalid restored companion references must be discarded.");

const partiallyCorruptDraft = model.migrateDraft({
  version: 4,
  title: "部分损坏草稿",
  exercises: [null, { name: "可恢复动作", sets: [null, { target: { reps: 8 }, actual: { reps: 7 } }] }]
}, { idFactory, startedAt: companionNow });
assert.equal(partiallyCorruptDraft.exercises.length, 1, "Invalid exercise fragments should be dropped without losing legal data.");
assert.equal(partiallyCorruptDraft.exercises[0].name, "可恢复动作");
assert.equal(partiallyCorruptDraft.exercises[0].sets[0].actual.reps, 7);

console.log("Workout session model tests passed.");
