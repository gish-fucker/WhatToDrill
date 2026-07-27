# Training Field Beta Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair first-workout selection, typed set recording, rest transitions, and mobile safety while adding a private local-only Beta funnel that supports a second-workout validation.

**Architecture:** `WorkoutSessionModel` owns canonical record types and session/rest state. A new pure `LocalBetaFunnelModel` owns event validation, storage, deduplication, retention, export, and summaries; `app.js` only connects business transitions to these two models and renders existing-page controls.

**Tech Stack:** Browser JavaScript, localStorage, HTML/CSS, Node.js assertion tests, Chrome DevTools Protocol smoke tests, GitHub Pages.

## Global Constraints

- Do not add community, leaderboard, video-course, payment, third-party analytics, new navigation, or new homepage analysis cards.
- The funnel is local-only and must never enter cloud snapshots, ordinary backups, or ordinary imports.
- Funnel events must not contain notes, actual exercise values, pain text, email, cookies, or identity tokens.
- Mobile acceptance widths are 320, 375, 390, and 430 px; primary actions must be at least 44 px high.
- Existing user changes in the main worktree are outside this branch and must not be staged or modified.
- Full smoke must pass twice consecutively before delivery.

---

### Task 1: Canonical exercise record types and legacy migration

**Files:**
- Modify: `public/workout-session-model.js`
- Modify: `scripts/workout-session-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `WorkoutSessionModel.RECORD_TYPES`, `inferRecordType(recordType, metric, note, exerciseName, values)`, `legacyMetricForRecordType(recordType)`, session sets with `recordType`, and records that retain `recordType` plus legacy `metric`.
- Consumes: existing `createSession`, `migrateDraft`, `completeSet`, `completedExercises`, and `toWorkoutRecord` entry points.

- [ ] **Step 1: Add failing type and migration assertions**

```js
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
```

- [ ] **Step 2: Verify the new assertions fail**

Run: `npm.cmd run test:workout-session`

Expected: failure because `RECORD_TYPES` and `inferRecordType` do not exist.

- [ ] **Step 3: Implement canonical normalization and compatibility output**

```js
const RECORD_TYPES = Object.freeze([
  "weighted_reps", "bodyweight_reps", "assisted_or_added_weight_reps",
  "duration_seconds", "duration_minutes", "completion_only"
]);

function legacyMetricForRecordType(recordType) {
  if (recordType === "duration_seconds") return "seconds";
  if (recordType === "duration_minutes") return "minutes";
  if (recordType === "completion_only") return "completion";
  return "reps";
}
```

Normalize every set with `recordType`, derive legacy `metric`, clear weight for bodyweight/duration/completion records, and clear both numeric values for `completion_only`. Bump the session model version and migrate versions 1-4 through `createSession` without losing existing values.

- [ ] **Step 4: Verify typed records and old drafts pass**

Run: `npm.cmd run test:workout-session`

Expected: `Workout session model tests passed.`

- [ ] **Step 5: Add the model test to syntax checks and commit**

Run: `npm.cmd run check`

Expected: exit code 0.

Commit: `feat: add typed workout records`

---

### Task 2: First-workout radio truth and typed input rendering

**Files:**
- Modify: `public/app/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `scripts/smoke-test.mjs`

**Interfaces:**
- Consumes: `WorkoutSessionModel.inferRecordType` and `legacyMetricForRecordType` from Task 1.
- Produces: built-in/template exercises with `recordType`, real default radio selection, and focused-set controls derived only from `recordType`.

- [ ] **Step 1: Add failing browser assertions for radio state and six record controls**

```js
assert.equal(firstSetup.checkedCondition, "bodyweight");
assert.equal(firstSetup.checkedCount, 1);
assert(firstSetup.keyboardChanged && firstSetup.accessibleName.includes("居家"));
assert(!typedControls.bodyweight.hasWeight);
assert(typedControls.weighted.hasWeight && typedControls.weighted.primaryLabel.includes("次"));
assert(typedControls.assisted.loadModes.includes("辅助") && typedControls.assisted.loadModes.includes("加重"));
assert.equal(typedControls.completion.numberInputs, 0);
```

- [ ] **Step 2: Verify the smoke assertions fail**

Run: `node scripts/smoke-test.mjs`

Expected: failure showing the condition radio is visually implied but unchecked or typed controls are missing.

- [ ] **Step 3: Make the default radio state real**

Add `checked` to the bodyweight radio, call `firstWorkoutChoice("firstWorkoutCondition", "bodyweight")` after `form.reset()`, and remove CSS selectors that style the first condition independently of `:checked`.

- [ ] **Step 4: Render inputs by record type**

Use these control rules in both focused session and editor rows:

```js
const control = {
  weighted_reps: { primary: "次数", weight: "重量 kg（可不填）" },
  bodyweight_reps: { primary: "次数", weight: null },
  assisted_or_added_weight_reps: { primary: "次数", weight: "辅助或加重 kg" },
  duration_seconds: { primary: "秒", weight: null },
  duration_minutes: { primary: "分钟", weight: null },
  completion_only: { primary: null, weight: null }
}[set.recordType];
```

For assisted/added loads render two buttons with pressed state; save assisted magnitude as a negative `weight` and added magnitude as positive. Add a record-type selector to custom exercise management so new custom actions are explicit; default unknown legacy actions to `weighted_reps`.

- [ ] **Step 5: Preserve record type through templates, plan generation, editor collection, import, and export**

Pass `recordType` in `cloneExercise`, `normalizeNextWorkoutPlan`, `collectExerciseRows`, templates, plan edits, Strong/Hevy migration, formal records, and backup normalization. Continue writing legacy `metric` next to `recordType`.

- [ ] **Step 6: Verify old data and all control types**

Run: `npm.cmd run test:workout-session && node scripts/smoke-test.mjs`

Expected: both commands exit 0 and the smoke JSON contains the six typed control checks.

- [ ] **Step 7: Commit the first-use and input work**

Commit: `fix: align onboarding and exercise inputs`

---

### Task 3: Rest-locked preview, expiry recovery, and reversible mobile actions

**Files:**
- Modify: `public/workout-session-model.js`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `scripts/workout-session-test.mjs`
- Modify: `scripts/smoke-test.mjs`

**Interfaces:**
- Produces: `WorkoutSessionModel.isRestLocked(session, now)`, expired-rest cleanup, read-only next-set preview, and one undo target for the most recent completed or skipped set.
- Consumes: existing companion rest timestamps and `clearRest`, `undoSet`, `remainingRestSeconds` model methods.

- [ ] **Step 1: Add failing rest lock and idempotency tests**

```js
assert.equal(model.isRestLocked(resting, "2026-07-27T08:00:30.000Z"), true);
assert.equal(model.isRestLocked(resting, "2026-07-27T08:02:00.000Z"), false);
assert.deepEqual(model.completeSet(completed, setId, {}), completed);
assert.deepEqual(model.skipSet(skipped, setId), skipped);
```

- [ ] **Step 2: Verify the model tests fail**

Run: `npm.cmd run test:workout-session`

Expected: failure because `isRestLocked` is missing and skip is not idempotent.

- [ ] **Step 3: Implement rest lock and safe repeated actions**

`isRestLocked` returns true only when a rest exists and remaining seconds are positive. `skipSet` clones without changing a non-pending set. Rendering an expired restored rest calls `clearRest`, persists once, and activates inputs.

- [ ] **Step 4: Split rest preview from active input markup**

While locked, render `focusedRestPreviewMarkup(current)` with action cue and target only. Do not render `focusedPrimaryValue`, `focusedWeightValue`, `completeFocusedSetBtn`, or `skipFocusedSetBtn`. Keep the full-plan details enabled. “立即开始下一组” clears the rest and focuses the current-set heading.

- [ ] **Step 5: Make completed and skipped sets reversible**

Replace `lastCompletedSetId` with a recent transition object `{ setId, action }`. Render a 44 px “撤销上一操作” button after either completion or skip, and clear it after undo. Existing finish/abandon confirmation dialogs remain unchanged.

- [ ] **Step 6: Add 320/375/390/430 browser assertions**

For each width assert no horizontal overflow, all visible training action heights are at least 44 px, no completion button exists during rest, only one primary rest action exists, number inputs scroll into the visual viewport, and complete/skip can be undone.

- [ ] **Step 7: Verify and commit rest/mobile behavior**

Run: `npm.cmd run test:workout-session && node scripts/smoke-test.mjs`

Expected: exit code 0, with width results for 320, 375, 390, and 430.

Commit: `fix: lock workout inputs during rest`

---

### Task 4: Pure local Beta funnel model

**Files:**
- Create: `public/local-beta-funnel-model.js`
- Create: `scripts/local-beta-funnel-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `LocalBetaFunnelModel.create(options)`, `record(name, context, dedupeKey)`, `list()`, `clear()`, `exportPayload()`, and static `summarize(events)`.
- Consumes: a storage adapter compatible with `localStorage`, `appVersion`, `algorithmVersion`, `now`, and `idFactory`.

- [ ] **Step 1: Write failing privacy, dedupe, capacity, clear, failure, and summary tests**

```js
const event = funnel.record("workout_started", {
  templateId: "starter_home_bodyweight", environment: "home_bodyweight", goal: "general",
  note: "private", weight: 80, email: "private@example.com"
}, "session-1:start");
assert.deepEqual(Object.keys(event).sort(), [
  "algorithmVersion", "appVersion", "environment", "goal",
  "installationId", "name", "templateId", "timestamp"
].sort());
assert.equal(funnel.record("workout_started", {}, "session-1:start"), null);
assert.equal(funnel.list().length, 1000);
assert.doesNotThrow(() => failingStorageFunnel.record("workout_started", {}, "x"));
```

- [ ] **Step 2: Verify the new suite fails**

Run: `node scripts/local-beta-funnel-test.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Implement strict allowlists and capped storage**

Use separate keys `whatToDrillLocalBetaEventsV1` and `whatToDrillLocalBetaMetaV1`. Validate event names, environment and goal enums, coerce IDs to bounded strings, retain the newest 1000 events, and catch every storage read/write exception. Never spread caller context into an event.

- [ ] **Step 4: Implement summary and export payload**

```js
return {
  firstWorkoutStarted: Number(events.some(event => event.name === "workout_started")),
  firstWorkoutCompleted: Number(events.some(event => event.name === "workout_completed")),
  nextPlanAccepted: Number(events.some(event => event.name === "next_plan_accepted")),
  secondWorkoutStarted: Number(events.some(event => event.name === "returned_workout_started")),
  secondWorkoutCompleted: Number(events.filter(event => event.name === "workout_completed").length >= 2),
  recommendationFeedback: feedbackCounts
};
```

- [ ] **Step 5: Verify and commit the pure model**

Run: `npm.cmd run test:local-beta-funnel && npm.cmd run check`

Expected: `Local Beta funnel tests passed.` and syntax checks exit 0.

Commit: `feat: add local beta funnel model`

---

### Task 5: Funnel integration, viewing, export, clearing, and privacy copy

**Files:**
- Modify: `public/app/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `public/privacy.html`
- Modify: `public/sw.js`
- Modify: `server.js`
- Modify: `README.md`
- Modify: `scripts/smoke-test.mjs`

**Interfaces:**
- Consumes: `LocalBetaFunnelModel` from Task 4 and existing session/plan IDs.
- Produces: event hooks at business transitions and a collapsible help/data-management surface with view, independent JSON export, and clear actions.

- [ ] **Step 1: Load the funnel model before app.js and initialize with release versions**

```html
<script src="../workout-session-model.js"></script>
<script src="../local-beta-funnel-model.js"></script>
<script src="../app.js"></script>
```

Create one funnel instance with the injected app version and `TrainingRotationModel.ALGORITHM_VERSION`.

- [ ] **Step 2: Record all ten events at successful state transitions**

Call `record` only after the underlying transition succeeds. Use session ID plus milestone for workout dedupe and plan ID plus action for plan dedupe. Emit `returned_workout_started` when at least one formal workout already exists. Emit `workout_abandoned` only from explicit abandonment or replacement of an active draft. Recommendation feedback accepts only UI feedback enums.

- [ ] **Step 3: Add the existing-page local Beta section**

Inside help/data management add a collapsed section containing the local-only explanation, event count, latest allowlisted events, “导出本地 Beta 记录”, and “清除本地 Beta 记录”. Do not add a nav item or homepage card.

- [ ] **Step 4: Keep funnel data outside ordinary data paths**

Assert `buildBackupPayload`, `buildCloudSnapshot`, import preview, ordinary reset behavior, and cloud serialization never reference the funnel keys. Funnel clear must not mutate `state`; ordinary local-data clear must not claim to clear Beta events unless the user uses the dedicated control.

- [ ] **Step 5: Update privacy, README, caching, and smoke assertions**

Copy must say “本地 Beta 记录不是在线用户分析”, “不会上传健康内容”, “不会进入云备份”, and “可单独查看、清除和导出”. Cache `local-beta-funnel-model.js`; ensure Node and Pages load it before `app.js`.

- [ ] **Step 6: Verify all funnel integration paths and commit**

Run: `npm.cmd run test:local-beta-funnel && node scripts/smoke-test.mjs`

Expected: smoke confirms ten event names, whitelist-only exports, dedupe, clear isolation, privacy wording, no console errors, and no mobile overflow.

Commit: `feat: integrate local beta validation`

---

### Task 6: Release verification, two smoke runs, manual mobile guide, push, and Pages

**Files:**
- Create: `docs/testing/2026-07-27-training-field-beta-mobile-checklist.md`
- Modify: `package.json`
- Modify: `public/sw.js`
- Modify: `README.md`
- Modify: `scripts/release-metadata-check.mjs` only if the existing release check requires another asset assertion.

**Interfaces:**
- Produces: version-consistent release, reproducible manual test steps, browser screenshots, pushed remote main, and verified public Pages deployment.
- Consumes: all prior task suites and existing `build:pages`/release metadata checks.

- [ ] **Step 1: Write the manual mobile checklist**

Document fresh onboarding, keyboard/screen-reader checks, one example for each record type, rest pause/resume/+30/skip/expiry/refresh, numeric-keyboard visibility, complete/skip/undo, local Beta view/export/clear, and 320/390 px expected results.

- [ ] **Step 2: Raise the patch version and align cache/release metadata**

Set `package.json` to the next patch version, update the service-worker cache name, and rely on the existing build injection for landing/app/privacy version references.

- [ ] **Step 3: Run all focused suites and repository checks**

Run: `npm.cmd run check && npm.cmd run test:workout-session && npm.cmd run test:local-beta-funnel && npm.cmd run test:training-rotation && npm.cmd run test:training-recommendation && npm.cmd run test:cloud-sync && npm.cmd run test:cloud-sync-server && npm.cmd run test:entitlements && git diff --check`

Expected: every command exits 0.

- [ ] **Step 4: Run complete smoke twice consecutively**

Run: `npm.cmd run test:smoke && npm.cmd run test:smoke`

Expected: two consecutive JSON results with `"ok": true`.

- [ ] **Step 5: Review screenshots and commit release metadata**

Inspect 320 and 390 px screenshots for overflow, keyboard/input visibility, rest action hierarchy, and undo visibility.

Commit: `docs: verify training beta release`

- [ ] **Step 6: Push the verified branch to remote main**

Run: `git push origin HEAD:main`

Expected: a fast-forward update of `origin/main`.

- [ ] **Step 7: Verify GitHub Pages workflow and public pages**

Use `gh run list`/`gh run watch` for the Pages workflow. Open the public root, `/app/`, and `/privacy.html`; verify the new version, model request status 200, default radio truth, local Beta section, no horizontal overflow at 320/390 px, and no console errors.

---

### Task 7: Optional single-boundary session controller extraction

**Files:**
- Create: `public/workout-session-controller.js`
- Create: `scripts/workout-session-controller-test.mjs`
- Modify: `public/app/index.html`
- Modify: `public/app.js`
- Modify: `public/sw.js`
- Modify: `package.json`

**Interfaces:**
- Produces: a controller that coordinates session create/restore/update/persist without DOM rendering.
- Consumes: `WorkoutSessionModel`, a draft storage adapter, and callbacks for change/error notifications.

- [ ] **Step 1: Start only after Task 6 public verification succeeds**

Do not begin if any main acceptance item is incomplete.

- [ ] **Step 2: Write a failing controller contract test**

```js
const controller = createWorkoutSessionController({ model, storage, onChange });
controller.start(plan);
controller.complete(setId, { reps: 10 });
assert.equal(controller.snapshot().exercises[0].sets[0].status, "completed");
assert.equal(JSON.parse(storage.value).version, model.VERSION);
```

- [ ] **Step 3: Extract only session lifecycle orchestration**

Move start, restore, actual-value update, complete, skip, undo, rest control, and draft persistence behind the controller. Leave rendering, cloud sync, event recording, templates, summaries, and navigation in `app.js`.

- [ ] **Step 4: Verify parity and commit separately**

Run: `npm.cmd run test:workout-session-controller && npm.cmd run test:workout-session && npm.cmd run test:smoke`

Expected: controller/model suites pass and smoke returns `"ok": true`.

Commit: `refactor: extract workout session controller`
