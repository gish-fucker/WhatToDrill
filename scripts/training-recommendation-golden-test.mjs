import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/training-rotation-model.js", import.meta.url), "utf8");
const context = vm.createContext({ console, Date, JSON, Map, Set });
vm.runInContext(source, context);
const model = context.TrainingRotationModel;

assert.equal(typeof model.buildRecommendationDecision, "function", "pure recommendation decision entry must exist");
assert.equal(typeof model.preserveUserPlan, "function", "manual next-plan preservation policy must exist");

const ALGORITHM_VERSION = "golden-1";
const rules = Object.freeze({
  EQUIPMENT: "R1_EQUIPMENT_SUBSET",
  ROTATION: "R2_AB_ROTATION",
  RECOVERY_RETURN: "R3_RECOVERY_RETURN",
  PAIN: "R4_PAIN_SAFETY",
  TEMP_RECOVERY: "R5_TEMP_RECOVERY",
  GOAL_DIFF: "R6_GOAL_DIFFERENCE",
  SAME_EXERCISE: "R7_SAME_EXERCISE_SOURCE",
  NO_BLIND_LOAD: "R8_NO_BLIND_LOAD",
  MANUAL_PLAN: "R9_MANUAL_PLAN_PRESERVED",
  VALID_RESULT: "R10_VALID_RESULT",
  TRUE_REASONS: "R11_TRUE_REASONS",
  DATE: "R12_SCHEDULE_DATE",
  PRIVACY: "R13_NO_HEALTH_COPY"
});

function sets(weight = null, reps = 10, rpe = 6, count = 3) {
  return Array.from({ length: count }, () => ({ weight, reps, rpe, note: "" }));
}

const templates = [
  { id: "starter_home_bodyweight", name: "居家无器械全身 A", builtIn: true, duration: 24, exercises: [
    { name: "椅子深蹲", requiredEquipment: ["bodyweight"], sets: sets(null, 10, 5, 2) },
    { name: "墙壁俯卧撑", requiredEquipment: ["bodyweight"], sets: sets(null, 10, 5, 2) }
  ] },
  { id: "starter_home_bodyweight_b", name: "居家无器械全身 B", builtIn: true, duration: 24, exercises: [
    { name: "分腿蹲", requiredEquipment: ["bodyweight"], sets: sets(null, 8, 5, 2) },
    { name: "死虫", requiredEquipment: ["bodyweight"], sets: sets(null, 8, 5, 2) }
  ] },
  { id: "starter_dumbbell_full_body", name: "哑铃全身 A", builtIn: true, duration: 28, exercises: [
    { name: "高脚杯深蹲", requiredEquipment: ["dumbbells"], sets: sets(10, 10) },
    { name: "哑铃地板卧推", requiredEquipment: ["dumbbells"], sets: sets(8, 10) }
  ] },
  { id: "starter_dumbbell_full_body_b", name: "哑铃全身 B", builtIn: true, duration: 28, exercises: [
    { name: "哑铃反向弓步", requiredEquipment: ["dumbbells"], sets: sets(8, 8) },
    { name: "哑铃肩推", requiredEquipment: ["dumbbells"], sets: sets(6, 8) }
  ] },
  { id: "beginner_full_body", name: "健身房全身 A", builtIn: true, duration: 35, exercises: [
    { name: "腿举", requiredEquipment: ["machines"], sets: sets(30, 10) },
    { name: "卧推", requiredEquipment: ["free_weights"], sets: sets(20, 8) },
    { name: "平板支撑", requiredEquipment: ["bodyweight"], sets: sets(null, 30, 5, 2) }
  ] },
  { id: "beginner_full_body_b", name: "健身房全身 B", builtIn: true, duration: 35, exercises: [
    { name: "器械推胸", requiredEquipment: ["machines"], sets: sets(20, 10) },
    { name: "罗马尼亚硬拉", requiredEquipment: ["free_weights"], sets: sets(30, 8) },
    { name: "死虫", requiredEquipment: ["bodyweight"], sets: sets(null, 10, 5, 2) }
  ] },
  { id: "beginner_recovery", name: "恢复拉伸", builtIn: true, duration: 15, exercises: [
    { name: "快走", requiredEquipment: ["bodyweight"], sets: sets(null, 10, 3, 1) },
    { name: "动态拉伸", requiredEquipment: ["bodyweight"], sets: sets(null, 8, 3, 1) }
  ] }
];

function baseInput(overrides = {}) {
  return {
    templates,
    rotation: model.defaultRotation(),
    environment: "home_bodyweight",
    equipment: "bodyweight",
    goal: "general",
    recovery: { sleepHours: 7.5, energy: 4, soreness: 1, pain: 0 },
    workouts: [],
    sourceDate: "2026-07-27",
    currentDate: "2026-07-27",
    weeklyWorkoutTarget: 2,
    plannedWorkoutDays: [],
    ...overrides
  };
}

function workout({ id, date, dayId, templateId, name = "椅子深蹲", weight = 10, reps = 10, rpe = 6, feeling = "right", targetMet = true, unfinished = 0 }) {
  return {
    id,
    date,
    createdAt: `${date}T10:00:00.000Z`,
    rotationDayId: dayId,
    sourceTemplateId: templateId,
    sessionRpe: rpe,
    feeling,
    targetMet,
    completionSummary: { completed: 6, pending: unfinished, skipped: 0, unfinishedExerciseNames: unfinished ? [name] : [] },
    exercises: [{ name, sets: sets(weight, reps, rpe, 2) }]
  };
}

const scenarios = [
  { id: "legacy-home-baseline", rules: [rules.EQUIPMENT, rules.VALID_RESULT], input: { environment: "home", equipment: "bodyweight" }, check(result) {
    assert.equal(result.decision.selectedTemplateId, "starter_home_bodyweight");
    assert.deepEqual(Array.from(result.decision.environmentConstraint.allowedEquipment), ["bodyweight"]);
  } },
  { id: "home-bodyweight-b-muscle", rules: [rules.EQUIPMENT, rules.ROTATION, rules.GOAL_DIFF], input: { rotation: { ...model.defaultRotation(), currentIndex: 1 }, goal: "muscle_gain" }, check(result) {
    assert.equal(result.decision.selectedTemplateId, "starter_home_bodyweight_b");
    assert.equal(result.decision.routineTransition, "A_TO_B");
    assert.equal(result.decision.goalPrescription, "MUSCLE_GAIN_DOUBLE_PROGRESSION");
  } },
  { id: "home-dumbbell-strength", rules: [rules.EQUIPMENT, rules.GOAL_DIFF], input: { environment: "home_dumbbell", equipment: "dumbbells", goal: "strength" }, check(result) {
    assert.equal(result.decision.selectedTemplateId, "starter_dumbbell_full_body");
    assert.ok(result.exercises.every(item => item.requiredEquipment.every(value => ["bodyweight", "dumbbells"].includes(value))));
    assert.equal(result.exercises[0].sets[0].reps, 5);
  } },
  { id: "mixed-dumbbell-fat-loss", rules: [rules.EQUIPMENT, rules.GOAL_DIFF], input: { environment: "mixed", equipment: "dumbbells", goal: "fat_loss" }, check(result) {
    assert.equal(result.decision.selectedTemplateId, "starter_dumbbell_full_body");
    assert.equal(result.decision.goalPrescription, "FAT_LOSS_DENSITY");
  } },
  { id: "gym-machines-only", rules: [rules.EQUIPMENT, rules.VALID_RESULT], input: { environment: "gym", equipment: "machines" }, check(result) {
    assert.ok(result.exercises.some(item => item.requiredEquipment.includes("machines")));
    assert.ok(result.exercises.every(item => item.requiredEquipment.every(value => ["bodyweight", "machines"].includes(value))));
  } },
  { id: "gym-machines-b-easy", rules: [rules.EQUIPMENT, rules.SAME_EXERCISE], input: {
    environment: "gym", equipment: "machines", rotation: { ...model.defaultRotation(), currentIndex: 1 },
    workouts: [workout({ id: "machine-b", date: "2026-07-20", dayId: "rotation_full_body_b", templateId: "beginner_full_body_b", name: "器械推胸", weight: 20, rpe: 4, feeling: "easy" })]
  }, check(result) { assert.equal(result.exercises.find(item => item.name === "器械推胸").sets[0].weight, 22.5); } },
  { id: "gym-free-weights-strength", rules: [rules.EQUIPMENT, rules.GOAL_DIFF], input: { environment: "gym", equipment: "free_weights", goal: "strength" }, check(result) {
    assert.ok(result.exercises.every(item => item.requiredEquipment.every(value => ["bodyweight", "free_weights"].includes(value))));
    assert.ok(result.exercises.some(item => item.name === "卧推"));
  } },
  { id: "gym-free-incomplete", rules: [rules.NO_BLIND_LOAD, rules.EQUIPMENT], input: {
    environment: "gym", equipment: "free_weights",
    workouts: [workout({ id: "failed", date: "2026-07-23", dayId: "rotation_full_body", templateId: "beginner_full_body", name: "卧推", weight: 25, unfinished: 1, targetMet: false })]
  }, check(result) { assert.equal(result.exercises.find(item => item.name === "卧推").sets[0].weight, 25); } },
  { id: "legacy-gym-empty-equipment", rules: [rules.EQUIPMENT], input: { environment: "gym", equipment: "" }, check(result) {
    assert.equal(result.decision.environmentConstraint.mode, "LEGACY_GYM_COMPATIBLE");
    assert.ok(result.exercises.length > 0);
  } },
  { id: "recovery-goal", rules: [rules.TEMP_RECOVERY, rules.GOAL_DIFF], input: { goal: "recovery" }, check(result) {
    assert.equal(result.decision.recoveryAdjustment, "RECOVERY_GOAL_LIGHT_SESSION");
    assert.ok(result.exercises.every(item => item.sets.every(set => set.rpe <= 3)));
  } },
  { id: "high-pain-safety", rules: [rules.PAIN, rules.RECOVERY_RETURN, rules.TRUE_REASONS, rules.PRIVACY], input: { recovery: { sleepHours: 7, energy: 4, soreness: 2, pain: 4 } }, check(result) {
    assert.equal(result.decision.safetyOverride, "HIGH_PAIN_RECOVERY_NON_DIAGNOSTIC");
    assert.equal(result.decision.selectedTemplateId, "beginner_recovery");
    assert.match(result.reasons.join(" "), /不构成医疗诊断/);
    assert.doesNotMatch(JSON.stringify(result.decision), /sleepHours|energy|soreness|pain/);
  } },
  { id: "low-energy-temporary", rules: [rules.TEMP_RECOVERY, rules.TRUE_REASONS], input: { recovery: { sleepHours: 7, energy: 2, soreness: 1, pain: 0 } }, check(result) {
    assert.equal(result.decision.recoveryAdjustment, "TEMPORARY_VOLUME_REDUCTION");
    assert.equal(result.decision.routineTransition, "HOLD_A_TEMPORARY_ADJUSTMENT");
    assert.match(result.adjustments.join(" "), /本次/);
  } },
  { id: "poor-sleep-temporary", rules: [rules.TEMP_RECOVERY], input: { recovery: { sleepHours: 5.5, energy: 3, soreness: 1, pain: 0 } }, check(result) {
    assert.equal(result.decision.recoveryAdjustment, "TEMPORARY_VOLUME_REDUCTION");
  } },
  { id: "high-soreness-temporary", rules: [rules.TEMP_RECOVERY], input: { recovery: { sleepHours: 7, energy: 3, soreness: 4, pain: 0 } }, check(result) {
    assert.equal(result.decision.recoveryAdjustment, "TEMPORARY_VOLUME_REDUCTION");
  } },
  { id: "unknown-recovery-does-not-adjust", rules: [rules.TEMP_RECOVERY, rules.TRUE_REASONS], input: { recovery: { sleepHours: null, energy: null, soreness: 0, pain: 0 } }, check(result) {
    assert.equal(result.decision.recoveryAdjustment, "NONE");
    assert.doesNotMatch(result.reasons.join(" "), /恢复状态只调整/);
  } },
  { id: "no-history-baseline", rules: [rules.VALID_RESULT, rules.SAME_EXERCISE], input: {}, check(result) {
    assert.equal(result.decision.progressionSource.type, "TEMPLATE_BASELINE");
    assert.match(result.reasons.join(" "), /首次基线/);
  } },
  { id: "after-a-default-b", rules: [rules.ROTATION], input: { rotation: { ...model.defaultRotation(), currentIndex: 1 } }, check(result) {
    assert.equal(result.decision.routineTransition, "A_TO_B");
  } },
  { id: "after-b-default-a", rules: [rules.ROTATION], input: { rotation: { ...model.defaultRotation(), currentIndex: 0 } }, check(result) {
    assert.equal(result.decision.routineTransition, "B_TO_A");
  } },
  { id: "recovery-holds-original-b", rules: [rules.RECOVERY_RETURN, rules.ROTATION], input: {
    rotation: { ...model.defaultRotation(), currentIndex: 1 }, recovery: { sleepHours: 7, energy: 3, soreness: 2, pain: 5 }
  }, check(result) { assert.equal(result.decision.routineTransition, "RECOVERY_HOLD_B"); } },
  { id: "easy-same-exercise-progresses", rules: [rules.SAME_EXERCISE, rules.NO_BLIND_LOAD], input: {
    environment: "home_dumbbell", equipment: "dumbbells", goal: "muscle_gain",
    workouts: [workout({ id: "easy", date: "2026-07-22", dayId: "rotation_full_body", templateId: "starter_dumbbell_full_body", name: "高脚杯深蹲", weight: 10, reps: 10, rpe: 4, feeling: "easy" })]
  }, check(result) {
    assert.equal(result.decision.progressionSource.workoutId, "easy");
    assert.equal(result.exercises.find(item => item.name === "高脚杯深蹲").sets[0].reps, 11);
  } },
  { id: "one-failure-holds", rules: [rules.NO_BLIND_LOAD], input: {
    environment: "home_dumbbell", equipment: "dumbbells",
    workouts: [workout({ id: "fail-1", date: "2026-07-22", dayId: "rotation_full_body", templateId: "starter_dumbbell_full_body", name: "高脚杯深蹲", weight: 12, targetMet: false })]
  }, check(result) { assert.equal(result.exercises.find(item => item.name === "高脚杯深蹲").sets[0].weight, 12); } },
  { id: "two-failures-deload", rules: [rules.NO_BLIND_LOAD, rules.TRUE_REASONS], input: {
    environment: "home_dumbbell", equipment: "dumbbells",
    workouts: [
      workout({ id: "fail-old", date: "2026-07-18", dayId: "rotation_full_body", templateId: "starter_dumbbell_full_body", name: "高脚杯深蹲", weight: 12, targetMet: false }),
      workout({ id: "fail-new", date: "2026-07-22", dayId: "rotation_full_body", templateId: "starter_dumbbell_full_body", name: "高脚杯深蹲", weight: 12, targetMet: false })
    ]
  }, check(result) {
    assert.equal(result.exercises.find(item => item.name === "高脚杯深蹲").sets.length, 1);
    assert.match(result.adjustments.join(" "), /连续两次/);
  } },
  { id: "older-same-exercise-beats-recent-different", rules: [rules.SAME_EXERCISE], input: {
    environment: "home_dumbbell", equipment: "dumbbells",
    workouts: [
      workout({ id: "same-old", date: "2026-07-18", dayId: "rotation_full_body", templateId: "starter_dumbbell_full_body", name: "高脚杯深蹲", weight: 14 }),
      workout({ id: "different-new", date: "2026-07-24", dayId: "rotation_full_body_b", templateId: "starter_dumbbell_full_body_b", name: "哑铃肩推", weight: 30 })
    ]
  }, check(result) {
    assert.equal(result.exercises.find(item => item.name === "高脚杯深蹲").sets[0].weight, 14);
    assert.equal(result.decision.progressionSource.workoutId, "same-old");
  } },
  { id: "missed-date-rebased", rules: [rules.DATE], input: { sourceDate: "2026-07-20", currentDate: "2026-07-27" }, check(result) {
    assert.equal(result.decision.scheduledDateReason, "MISSED_DATE_REBASED");
    assert.ok(result.scheduledFor > "2026-07-27");
  } },
  { id: "planned-weekday", rules: [rules.DATE], input: { plannedWorkoutDays: [3], weeklyWorkoutTarget: 3 }, check(result) {
    assert.equal(result.scheduledFor, "2026-07-29");
    assert.equal(result.decision.scheduledDateReason, "PLANNED_WEEKDAY");
  } },
  { id: "missing-template-invalid", rules: [rules.VALID_RESULT], input: { templates: templates.filter(item => item.id !== "starter_home_bodyweight") }, check(result) {
    assert.equal(result.valid, false);
    assert.equal(result.error, "MISSING_TEMPLATE");
  } },
  { id: "duplicate-source-names-get-unique-ids", rules: [rules.VALID_RESULT], input: {
    templates: templates.map(item => item.id === "starter_home_bodyweight" ? { ...item, exercises: [item.exercises[0], item.exercises[0]] } : item)
  }, check(result) {
    const ids = result.exercises.map(item => item.id);
    assert.equal(new Set(ids).size, ids.length);
  } },
  { id: "reasons-only-applied-adjustments", rules: [rules.TRUE_REASONS], input: {}, check(result) {
    assert.doesNotMatch(result.reasons.join(" "), /降低|疼痛|加重/);
    assert.equal(result.decision.algorithmVersion, ALGORITHM_VERSION);
  } }
];

const coveredRules = new Set();
for (const scenario of scenarios) {
  scenario.rules.forEach(rule => coveredRules.add(rule));
  const result = model.buildRecommendationDecision(baseInput(scenario.input));
  scenario.check(result);
  if (result.valid !== false) {
    assert.ok(result.exercises.length > 0, `${scenario.id}: plan must not be empty`);
    assert.equal(result.decision.algorithmVersion, ALGORITHM_VERSION, `${scenario.id}: algorithm version`);
    assert.ok(templates.some(template => template.id === result.decision.selectedTemplateId), `${scenario.id}: template must exist`);
  }
}

const manualPlan = { id: "user-plan", status: "planned", userDecision: "reduced_exercise", exercises: [{ id: "kept" }] };
const generatedPlan = { id: "generated", status: "suggested", exercises: [{ id: "new" }] };
assert.equal(model.preserveUserPlan(manualPlan, "render", generatedPlan), manualPlan);
assert.equal(model.preserveUserPlan(manualPlan, "explicit_preference_change", generatedPlan), generatedPlan);
coveredRules.add(rules.MANUAL_PLAN);

assert.deepEqual(new Set(Object.values(rules)), coveredRules, "every mandatory rule needs golden evidence");

console.log(JSON.stringify({
  ok: true,
  algorithmVersion: ALGORITHM_VERSION,
  goldenScenarioCount: scenarios.length + 1,
  scenarioIds: [...scenarios.map(item => item.id), "manual-plan-preserved-on-render"],
  coveredRules: Array.from(coveredRules)
}, null, 2));
