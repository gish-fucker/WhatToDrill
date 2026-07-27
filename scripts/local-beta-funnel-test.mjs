import assert from "node:assert/strict";
import "../public/local-beta-funnel-model.js";

const model = globalThis.LocalBetaFunnelModel;
assert.ok(model, "Local Beta funnel model should attach to globalThis.");

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values
  };
}

const storage = memoryStorage();
let tick = 0;
const funnel = model.create({
  storage,
  appVersion: "1.24.0",
  algorithmVersion: "golden-1",
  now: () => new Date(Date.UTC(2026, 6, 27, 0, 0, tick++)).toISOString(),
  idFactory: () => "installation-test"
});

const first = funnel.record("workout_started", {
  templateId: "starter_home_bodyweight",
  environment: "home_bodyweight",
  goal: "general",
  note: "PRIVATE_NOTE",
  weight: 80,
  pain: "PRIVATE_PAIN",
  email: "private@example.com",
  token: "PRIVATE_TOKEN"
}, "session-1:start");
assert.deepEqual(Object.keys(first).sort(), [
  "algorithmVersion", "appVersion", "environment", "goal",
  "installationId", "name", "templateId", "timestamp"
].sort());
assert.equal(JSON.stringify(first).includes("PRIVATE"), false, "Event serialization must discard private caller fields.");
assert.equal(funnel.record("workout_started", {}, "session-1:start"), null, "A repeated business transition must dedupe.");
assert.equal(funnel.list().length, 1);

funnel.record("workout_completed", { templateId: "starter_home_bodyweight", environment: "home_bodyweight", goal: "general" }, "session-1:complete");
funnel.record("next_plan_accepted", { templateId: "routine-b", environment: "home_bodyweight", goal: "general" }, "plan-1:accept");
funnel.record("returned_workout_started", { templateId: "routine-b", environment: "home_bodyweight", goal: "general" }, "session-2:return");
funnel.record("workout_completed", { templateId: "routine-b", environment: "home_bodyweight", goal: "general" }, "session-2:complete");
funnel.record("recommendation_feedback", { templateId: "routine-b", environment: "home_bodyweight", goal: "general", feedback: "helpful", note: "PRIVATE" }, "plan-1:feedback");

const summary = model.summarize(funnel.list());
assert.deepEqual(summary, {
  firstWorkoutStarted: 1,
  firstWorkoutCompleted: 1,
  nextPlanAccepted: 1,
  secondWorkoutStarted: 1,
  secondWorkoutCompleted: 1,
  recommendationFeedback: { helpful: 1, too_easy: 0, too_hard: 0, not_for_me: 0 }
});
assert.equal(funnel.exportPayload().events.length, funnel.list().length);
assert.deepEqual(funnel.exportPayload().summary, summary);

for (let index = 0; index < 1005; index += 1) {
  funnel.record("first_set_completed", { templateId: `routine-${index}`, environment: "gym", goal: "strength" }, `capacity-${index}`);
}
assert.equal(funnel.list().length, 1000, "The event log must retain only the newest 1000 events.");
assert.equal(funnel.list().at(-1).templateId, "routine-1004");

assert.equal(funnel.clear(), true);
assert.deepEqual(funnel.list(), []);
assert.equal(storage.values.has(model.META_KEY), false, "Clearing should remove installation and dedupe metadata.");

const failingStorage = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
  removeItem() { throw new Error("blocked"); }
};
const degraded = model.create({ storage: failingStorage, idFactory: () => "degraded-installation" });
assert.doesNotThrow(() => degraded.record("workout_started", {}, "degraded"));
assert.equal(degraded.record("workout_started", {}, "degraded"), null);
assert.deepEqual(degraded.list(), []);
assert.equal(degraded.clear(), false);

console.log("Local Beta funnel tests passed.");
