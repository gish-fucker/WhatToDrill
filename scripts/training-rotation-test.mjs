import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/training-rotation-model.js", import.meta.url), "utf8");
const context = vm.createContext({ console, Date, JSON, Map, Set });
vm.runInContext(source, context);
const model = context.TrainingRotationModel;

const templates = [
  { id: "beginner_full_body", name: "全身 A" },
  { id: "beginner_full_body_b", name: "全身 B" },
  { id: "beginner_upper", name: "上肢入门" },
  { id: "beginner_lower", name: "下肢入门" },
  { id: "custom_a", name: "上肢 A" },
  { id: "custom_b", name: "下肢 A" }
];

assert.equal(model.normalizeRotation({}, templates).mode, "full_body");
assert.deepEqual(Array.from(model.normalizeRotation({}, templates).days, day => day.id), ["rotation_full_body", "rotation_full_body_b"]);
assert.equal(model.advanceRotation(model.defaultRotation(), "rotation_full_body", templates).currentIndex, 1);
assert.equal(model.resolveNextDay({ mode: "upper_lower", currentIndex: 1 }, templates).day.templateId, "beginner_lower");

assert.equal(model.normalizeEnvironment("home", "bodyweight"), "home_bodyweight");
assert.equal(model.normalizeEnvironment("home", "dumbbells"), "home_dumbbell");
assert.notDeepEqual(model.routineTemplateIds("gym"), model.routineTemplateIds("home_bodyweight"));
assert.equal(model.routineTemplateIds("home_bodyweight").join(","), "starter_home_bodyweight,starter_home_bodyweight_b");

const prescriptionBase = {
  id: "test",
  exercises: [{ name: "深蹲", sets: Array.from({ length: 3 }, () => ({ weight: 20, reps: 10, rpe: 6, note: "" })) }]
};
const general = model.applyGoalPrescription(prescriptionBase, "general");
const muscle = model.applyGoalPrescription(prescriptionBase, "muscle_gain");
const strength = model.applyGoalPrescription(prescriptionBase, "strength");
const fatLoss = model.applyGoalPrescription(prescriptionBase, "fat_loss");
assert.equal(general.exercises[0].sets.length, 2);
assert.equal(muscle.exercises[0].sets.length, 3);
assert.equal(strength.exercises[0].sets[0].reps, 5);
assert.equal(fatLoss.exercises.at(-1).name, "轻松快走");
assert.match(muscle.progression, /先把每组次数/);

const custom = model.normalizeRotation({
  mode: "custom",
  currentIndex: 1,
  days: [
    { id: "a", templateId: "custom_a", label: "上肢 A" },
    { id: "b", templateId: "custom_b", label: "下肢 A" }
  ]
}, templates);
assert.equal(custom.mode, "custom");
assert.equal(model.resolveNextDay(custom, templates).day.id, "b");
assert.equal(model.advanceRotation(custom, "b", templates, "2026-07-15T00:00:00.000Z").currentIndex, 0);

const invalidCustom = model.normalizeRotation({
  mode: "custom",
  days: [{ id: "missing", templateId: "deleted" }]
}, templates);
assert.equal(invalidCustom.mode, "full_body");
assert.match(invalidCustom.issue, /至少需要 2 个/);

const comparable = model.findComparableWorkout([
  { id: "old", date: "2026-07-10", rotationDayId: "b", sourceTemplateId: "custom_b" },
  { id: "other", date: "2026-07-14", rotationDayId: "a", sourceTemplateId: "custom_a" },
  { id: "latest", date: "2026-07-12", rotationDayId: "b", sourceTemplateId: "custom_b" }
], custom.days[1]);
assert.equal(comparable.id, "latest");
assert.equal(model.findComparableWorkout([{ date: "2026-07-14", rotationDayId: "a" }], custom.days[1]), null);

const latestExercise = model.findLatestExercisePerformance([
  { id: "older", date: "2026-07-10", exercises: [{ name: "深蹲", sets: [{ weight: 30, reps: 10, rpe: 6 }] }] },
  { id: "latest", date: "2026-07-14", exercises: [{ name: "深蹲", sets: [{ weight: 35, reps: 8, rpe: 7 }] }] }
], "深蹲");
assert.equal(latestExercise.workout.id, "latest");
assert.equal(latestExercise.exercise.sets[0].weight, 35);

const workouts = [
  { date: "2026-06-01", exercises: [{ name: "卧推" }] },
  { date: "2026-06-03", exercises: [{ name: "卧推" }] },
  { date: "2026-06-29", exercises: [{ name: "腿举" }] }
];
const logs = Array.from({ length: 7 }, (_, index) => ({
  date: `2026-06-${String(index + 1).padStart(2, "0")}`,
  energy: 3
}));
const observationWorkouts = logs.map(log => ({ date: log.date, exercises: [] }));
const visibility = model.progressVisibility([...workouts, ...observationWorkouts], logs);
assert.equal(visibility.exerciseComparison, true);
assert.equal(visibility.weeklyTrend, true);
assert.equal(visibility.personalPatterns, true);
assert.equal(visibility.personalReport, true);
assert.equal(model.progressVisibility([], []).empty, true);

console.log("training rotation model tests passed");
