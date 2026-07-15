# Workout Companion Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rest timing, quick set adjustments, same-exercise weight reuse, vibration, wake lock, and clear next-exercise transitions to focused workouts.

**Architecture:** Upgrade `WorkoutSessionModel` to version 3 for pure, persistent companion state. Keep timers, DOM, vibration, and wake-lock handles in `public/app.js`; verify state with Node tests and user behavior with the existing CDP smoke suite.

**Tech Stack:** Browser JavaScript, localStorage, Screen Wake Lock API, Vibration API, Node.js assertions, Chrome DevTools Protocol, service worker/PWA.

## Global Constraints

- Rest defaults to 90 seconds with only `+30 秒`, `跳过休息`, and `重新计时` controls.
- Weight changes by 2.5 kg and repetitions by 1; values never go below zero.
- Automation never blocks or overwrites an existing actual value.
- Weight inheritance uses only the nearest completed set in the same exercise.
- Vibration and wake lock fail silently when absent or denied.
- No audio, background notifications, timer settings, onboarding, cloud sync, reports, rotation, or payment changes.
- Preserve history, draft migration, import/export, offline use, accessibility, and 390px no-overflow behavior.

## File Map

- `public/workout-session-model.js`: version-3 state and pure operations.
- `scripts/workout-session-test.mjs`: deterministic model tests.
- `public/app.js`: rendering, timer lifecycle, quick controls, vibration, wake lock, cleanup.
- `public/styles.css`: responsive companion UI.
- `scripts/smoke-test.mjs`: browser flows and optional-API stubs.
- `public/sw.js`, `package.json`, `server.js`: PWA and version delivery.

---

### Task 1: Version-3 companion model

**Files:**
- Modify: `public/workout-session-model.js:1-220`
- Test: `scripts/workout-session-test.mjs`

**Interfaces:**
- Consumes: existing session exercises, current set, set statuses, and ISO timestamps.
- Produces: `DEFAULT_REST_SECONDS`, `remainingRestSeconds`, `adjustRest`, `resetRest`, `clearRest`, `prefillCurrentWeight`, plus version-3 `companion` state.

- [ ] **Step 1: Write failing deterministic tests**

Add a two-exercise session and these assertions:

```js
const now = "2026-07-16T10:00:00.000Z";
let session = WorkoutSessionModel.createSession({
  exercises: [
    { name: "卧推", sets: [{ target: { weight: 40, reps: 8 } }, { target: { weight: 40, reps: 8 } }] },
    { name: "坐姿划船", sets: [{ target: { weight: 35, reps: 10 } }] }
  ]
}, { idFactory, startedAt: now });
const first = session.exercises[0].sets[0].id;
session = WorkoutSessionModel.completeSet(session, first, { weight: 42.5, reps: 8 }, { now });
assert.equal(session.version, 3);
assert.equal(session.companion.transition.kind, "set");
assert.equal(WorkoutSessionModel.remainingRestSeconds(session, "2026-07-16T10:00:30.000Z"), 60);
session = WorkoutSessionModel.prefillCurrentWeight(session);
assert.equal(session.exercises[0].sets[1].actual.weight, 42.5);
session = WorkoutSessionModel.adjustRest(session, 30);
assert.equal(WorkoutSessionModel.remainingRestSeconds(session, "2026-07-16T10:00:30.000Z"), 90);
session = WorkoutSessionModel.resetRest(session, "2026-07-16T10:01:00.000Z");
assert.equal(WorkoutSessionModel.remainingRestSeconds(session, "2026-07-16T10:01:00.000Z"), 90);
assert.equal(WorkoutSessionModel.clearRest(session).companion.rest, null);
```

Also update the existing legacy assertion from version 2 to version 3, then assert: final completion creates no rest; moving to another exercise yields `kind: "exercise"`; skipped and other-exercise weights are ignored; an existing actual weight is preserved; undo clears its timer; manual selection clears stale transition; version-1 and version-2 drafts migrate with empty companion state.

- [ ] **Step 2: Prove the tests fail**

Run: `npm.cmd run test:workout-session`

Expected: FAIL because model version 3 and companion functions are missing.

- [ ] **Step 3: Implement normalized state and helpers**

Add:

```js
const VERSION = 3;
const DEFAULT_REST_SECONDS = 90;
function emptyCompanion() { return { rest: null, transition: null }; }
function normalizeCompanion(value = {}) {
  const rest = value.rest?.sourceSetId && value.rest?.startedAt && value.rest?.endsAt
    ? { sourceSetId: normalizeText(value.rest.sourceSetId), startedAt: value.rest.startedAt, endsAt: value.rest.endsAt }
    : null;
  const transition = value.transition?.sourceSetId && value.transition?.targetSetId
    ? { sourceSetId: normalizeText(value.transition.sourceSetId), targetSetId: normalizeText(value.transition.targetSetId), kind: value.transition.kind === "exercise" ? "exercise" : "set" }
    : null;
  return { rest, transition };
}
```

Add `companion: normalizeCompanion(plan.companion)` to `createSession`. Migrate older drafts with `emptyCompanion()`. Implement and export:

```js
function remainingRestSeconds(session, now = new Date().toISOString()) {
  const end = Date.parse(session.companion?.rest?.endsAt);
  const current = Date.parse(now);
  return Number.isFinite(end) && Number.isFinite(current) ? Math.max(0, Math.ceil((end - current) / 1000)) : 0;
}
function adjustRest(session, deltaSeconds) {
  const next = clone(session);
  const end = Date.parse(next.companion?.rest?.endsAt);
  if (Number.isFinite(end)) next.companion.rest.endsAt = new Date(end + Number(deltaSeconds) * 1000).toISOString();
  return next;
}
function resetRest(session, now = new Date().toISOString()) {
  const next = clone(session);
  if (!next.companion?.rest) return next;
  next.companion.rest.startedAt = now;
  next.companion.rest.endsAt = new Date(Date.parse(now) + DEFAULT_REST_SECONDS * 1000).toISOString();
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
  const index = exercise.sets.findIndex(set => set.id === next.currentSetId);
  const current = exercise.sets[index];
  if (!current || current.actual.weight !== null) return next;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = exercise.sets[cursor];
    if (candidate.status !== "completed") continue;
    const weight = candidate.actual.weight ?? candidate.target.weight;
    if (weight !== null) current.actual.weight = weight;
    break;
  }
  return next;
}
```

Change `completeSet(session, setId, patch, options = {})` to create absolute rest timestamps and classify its next transition. Make skip, undo, and select clear invalid companion state.

- [ ] **Step 4: Prove model tests pass**

Run: `npm.cmd run test:workout-session`

Expected: `Workout session model tests passed.`

- [ ] **Step 5: Commit**

```powershell
git add -- public/workout-session-model.js scripts/workout-session-test.mjs
git commit -m "Add workout companion session state"
```

### Task 2: Rest UI, quick controls, and transition behavior

**Files:**
- Modify: `public/app.js:118-125, 950-1048, 1638-1841, 7380-7463`
- Test: `scripts/smoke-test.mjs`

**Interfaces:**
- Consumes: Task 1 model helpers.
- Produces: `startFocusedRestTicker`, `stopFocusedRestTicker`, `adjustFocusedValue`, rest controls, and stepper controls.

- [ ] **Step 1: Write a failing browser flow**

Start a three-set, two-exercise session, enter `42.5`, complete the first set, then assert:

```js
const result = await evaluate(cdp, `(() => ({
  timer: document.querySelector("#focusedRestTime")?.textContent,
  context: document.querySelector("#focusedRestContext")?.textContent,
  weight: document.querySelector("#focusedWeightValue")?.value
}))()`);
assert(result.timer === "01:30", "A completed set should start 90 seconds of rest.");
assert(result.context.includes("下一组"), "Within-exercise rest should identify the next set.");
assert(result.weight === "42.5", "The next set should inherit the completed weight.");
```

Click each rest and stepper control and assert exact persisted values. Complete the last bench set and assert `下一动作：坐姿划船`. Undo and assert the originating rest disappears.

- [ ] **Step 2: Prove the browser flow fails**

Run: `npm.cmd run test:smoke`

Expected: FAIL because rest and quick-control elements do not exist.

- [ ] **Step 3: Implement rendering and ticker lifecycle**

Add runtime state:

```js
let focusedRestTimer = null;
let lastRestAlertKey = "";
```

Render this shape above the current set when companion context exists:

```html
<section class="focused-rest-panel" aria-label="组间休息">
  <div><span id="focusedRestLabel">休息中</span><strong id="focusedRestTime">01:30</strong><p id="focusedRestContext"></p></div>
  <div class="focused-rest-actions">
    <button id="extendFocusedRestBtn" type="button">+30 秒</button>
    <button id="resetFocusedRestBtn" type="button">重新计时</button>
    <button id="skipFocusedRestBtn" type="button">跳过休息</button>
  </div>
</section>
```

`startFocusedRestTicker()` owns one `setInterval` at 250ms, computes from absolute time, changes to `休息完成，可以继续` once at zero, and updates only timer elements. `stopFocusedRestTicker()` clears and nulls the handle.

- [ ] **Step 4: Implement quick-control markup and behavior**

Wrap repetition and weight inputs with:

```html
<div class="focused-value-stepper">
  <button id="decreaseFocusedPrimaryBtn" type="button" aria-label="次数减少 1">−1</button>
  <input id="focusedPrimaryValue" type="number">
  <button id="increaseFocusedPrimaryBtn" type="button" aria-label="次数增加 1">+1</button>
</div>
```

Use equivalent weight buttons with `−2.5` and `+2.5`. Implement `adjustFocusedValue(inputId, delta)` to parse the displayed base, clamp to zero, format without trailing zeroes, dispatch `input`, and persist. Bind all timer and stepper buttons through existing delegated click handling.

- [ ] **Step 5: Integrate persistence and cleanup**

After complete/restore/select/undo, call model helpers, persist, render, and synchronize the ticker. Stop the ticker during clear, successful finish, abandon, reset, and unload.

- [ ] **Step 6: Prove model and smoke tests pass**

Run:

```powershell
npm.cmd run test:workout-session
npm.cmd run test:smoke
```

Expected: both exit 0.

- [ ] **Step 7: Commit**

```powershell
git add -- public/app.js scripts/smoke-test.mjs
git commit -m "Add guided rest and quick set controls"
```

### Task 3: Vibration and wake lock

**Files:**
- Modify: `public/app.js:118-125, 1804-1841, 7200-7475`
- Test: `scripts/smoke-test.mjs`

**Interfaces:**
- Consumes: active session, rest zero-crossing, tab and document visibility.
- Produces: `vibrateWorkout`, `syncWorkoutWakeLock`, and `releaseWorkoutWakeLock`.

- [ ] **Step 1: Add failing supported/unsupported API tests**

Stub APIs before initialization:

```js
window.__vibrationCalls = [];
Object.defineProperty(navigator, "vibrate", { configurable: true, value: pattern => { window.__vibrationCalls.push(pattern); return true; } });
window.__wakeLockEvents = [];
Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async type => {
  window.__wakeLockEvents.push("request:" + type);
  return { released: false, release: async () => window.__wakeLockEvents.push("release"), addEventListener() {} };
} } });
```

Assert one pulse after set completion, two pulses only when a visible live countdown crosses zero, request during active workout, and release on tab exit or finish. Reload without both APIs and assert no console errors.

- [ ] **Step 2: Prove smoke tests fail**

Run: `npm.cmd run test:smoke`

Expected: FAIL because API lifecycle behavior is absent.

- [ ] **Step 3: Implement capability-safe integrations**

Add:

```js
let workoutWakeLock = null;
let workoutWakeLockRequest = null;
function vibrateWorkout(pattern) { try { navigator.vibrate?.(pattern); } catch {} }
async function releaseWorkoutWakeLock() {
  const lock = workoutWakeLock;
  workoutWakeLock = null;
  if (lock && !lock.released) try { await lock.release(); } catch {}
}
async function syncWorkoutWakeLock() {
  const active = Boolean(activeWorkoutSession) && document.visibilityState === "visible"
    && $("workout")?.classList.contains("active");
  if (!active || !navigator.wakeLock?.request) return releaseWorkoutWakeLock();
  if (workoutWakeLock || workoutWakeLockRequest) return;
  workoutWakeLockRequest = navigator.wakeLock.request("screen");
  try { workoutWakeLock = await workoutWakeLockRequest; workoutWakeLock.addEventListener?.("release", () => { workoutWakeLock = null; }); }
  catch { workoutWakeLock = null; }
  finally { workoutWakeLockRequest = null; }
}
```

Pulse `35` after completion and `[45, 50, 45]` only on a visible zero-crossing. Sync wake lock on start, restore, tab activation, visibility change, finish, abandon, reset, and unload.

- [ ] **Step 4: Prove supported and absent API cases pass**

Run: `npm.cmd run test:smoke`

Expected: exit 0 with no browser console errors.

- [ ] **Step 5: Commit**

```powershell
git add -- public/app.js scripts/smoke-test.mjs
git commit -m "Add workout device feedback lifecycle"
```

### Task 4: Responsive delivery and final acceptance

**Files:**
- Modify: `public/styles.css`
- Modify: `public/sw.js:1-20`
- Modify: `public/app/index.html:8-18`
- Modify: `public/app.js:1-4`
- Modify: `package.json:1-4`
- Modify: `server.js:15-20`
- Test: `scripts/smoke-test.mjs`
- Evidence: `output/playwright/what-to-drill-workout-companion-desktop.png`
- Evidence: `output/playwright/what-to-drill-workout-companion-mobile.png`

**Interfaces:**
- Consumes: Tasks 1-3 class names and behavior.
- Produces: accessible 44px controls, 390px layout, cache refresh, version `1.20.0`, and browser evidence.

- [ ] **Step 1: Add failing desktop/mobile layout assertions**

Assert every visible companion button is at least 44px tall, panel width does not exceed viewport width, and `document.documentElement.scrollWidth === document.documentElement.clientWidth` at desktop and 390px.

- [ ] **Step 2: Prove layout assertions fail**

Run: `npm.cmd run test:smoke`

Expected: FAIL until responsive styling exists.

- [ ] **Step 3: Add responsive styles**

```css
.focused-rest-panel { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px; border:1px solid var(--line); border-radius:var(--radius); background:var(--surface-soft); }
.focused-rest-panel strong { font-size:clamp(26px, 5vw, 38px); }
.focused-rest-actions, .focused-value-stepper { display:flex; align-items:center; gap:8px; }
.focused-rest-actions button, .focused-value-stepper button { min-width:44px; min-height:44px; }
.focused-value-stepper input { min-width:0; text-align:center; }
@media (max-width:640px) {
  .focused-rest-panel { align-items:stretch; flex-direction:column; }
  .focused-rest-actions { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); }
  .focused-value-stepper { display:grid; grid-template-columns:auto minmax(0,1fr) auto; }
}
```

Add non-animated `.exercise-transition` emphasis and preserve reduced-motion behavior.

- [ ] **Step 4: Align delivery versions**

Set app, package, and server versions to `1.20.0`. Change the service-worker cache name and both the service-worker and `public/app/index.html` app/style query strings to `20260716-workout-companion-v1`.

- [ ] **Step 5: Run the complete automated suite**

```powershell
npm.cmd run check
npm.cmd run test:workout-session
npm.cmd run test:training-rotation
npm.cmd run test:entitlements
npm.cmd run test:smoke
```

Expected: every command exits 0.

- [ ] **Step 6: Run real-browser acceptance**

Use the Playwright skill workflow with clean local storage. Complete a multi-exercise session on desktop and 390px, exercise timer/stepper/undo/tab lifecycle, inspect focus and console, and save the two evidence screenshots named above.

- [ ] **Step 7: Audit and commit**

```powershell
git diff --check
git status --short
git add -- public/styles.css public/sw.js public/app/index.html public/app.js package.json server.js scripts/smoke-test.mjs
git commit -m "Polish and deliver workout companion tools"
```

- [ ] **Step 8: Map acceptance evidence**

Record proof for rest timer, weight shortcuts, repetition shortcuts, previous-set weight, completion vibration, screen wake lock, and next-exercise emphasis. Keep the broader goal active because onboarding/template adaptation, next-plan action removal, and cloud backup remain later phases.
