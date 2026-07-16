# Next Plan Remove Exercise Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users remove exactly one exercise from the suggested next workout before confirming it, without mutating templates or training rotation.

**Architecture:** Treat removal as a user edit on the current `nextWorkoutPlan` snapshot. Rebuild the plan through the existing normalizer, update duration and explanatory copy, persist immediately, and keep source templates and rotation definitions unchanged.

**Tech Stack:** Browser JavaScript, localStorage, HTML dialog UI, CSS, CDP smoke tests.

## Global Constraints

- The action appears only when a non-recovery plan has at least two exercises.
- A plan must always retain at least one exercise.
- Removing an exercise never edits templates, workout history, or rotation days.
- Changing the rotation day or converting to recovery regenerates from source and discards the one-off removal.
- Starting the plan uses exactly the edited exercise list.
- Controls remain keyboard accessible, at least 44px high, and usable at 390px.

## File Map

- `public/app.js`: render the action, apply the immutable one-off edit, persist, and announce the result.
- `public/styles.css`: responsive action layout and focus-visible treatment.
- `scripts/smoke-test.mjs`: browser coverage for removal, persistence, regeneration, and mobile accessibility.

---

### Task 1: Add failing next-plan edit coverage

**Files:**
- Test: `scripts/smoke-test.mjs`

**Interfaces:**
- Consumes: `showNextWorkoutResult(workout, plan)`, `state.nextWorkoutPlan`, `startNextWorkoutPlan()`.
- Produces: acceptance evidence for a one-off exercise removal.

- [ ] **Step 1: Create a multi-exercise suggested plan fixture**

Use the existing upper/lower rotation fixture, open the completion result dialog, and capture `state.nextWorkoutPlan.exercises.map(item => item.name)` before editing.

- [ ] **Step 2: Assert the action fails before implementation**

```js
const removeButton = document.querySelector("#removeNextWorkoutExerciseBtn");
assert(removeButton, "Editable suggested plans should offer 减少一个动作.");
```

Run: `npm.cmd run test:smoke`

Expected: FAIL because the action does not exist.

- [ ] **Step 3: Add exact behavior assertions**

After clicking the action, assert the exercise count decreases by one, the retained names preserve order, estimated duration decreases but stays positive, the plan is persisted, the dialog stays open, and the announcement names the removed exercise. Close/reopen and assert the edit survives. Start the plan and assert the session uses the edited list. Also assert a one-exercise plan and recovery plan do not show the action.

### Task 2: Implement the one-off edit

**Files:**
- Modify: `public/app.js:2302-2412,7591-7607`

**Interfaces:**
- Consumes: `normalizeNextWorkoutPlan(plan)`, `persistState()`, `showNextWorkoutResult()`.
- Produces: `removeExerciseFromSuggestedNextWorkout()`.

- [ ] **Step 1: Render the action**

Inside `showNextWorkoutResult`, render this only for a non-recovery plan with more than one exercise:

```html
<button id="removeNextWorkoutExerciseBtn" class="ghost-button" type="button">
  减少一个动作
</button>
```

- [ ] **Step 2: Add the edit function**

```js
function removeExerciseFromSuggestedNextWorkout() {
  const plan = state.nextWorkoutPlan;
  if (!plan || plan.source === "recovery_override" || plan.exercises.length <= 1) return;
  const removed = plan.exercises.at(-1);
  const next = normalizeNextWorkoutPlan({
    ...plan,
    exercises: plan.exercises.slice(0, -1),
    estimatedDuration: Math.max(8, plan.estimatedDuration - Math.max(4, Math.round(plan.estimatedDuration / plan.exercises.length))),
    adjustments: [...plan.adjustments, `已按你的选择移除 ${removed.name}`],
    userDecision: "reduced_exercise"
  });
  state.nextWorkoutPlan = next;
  persistState();
  showNextWorkoutResult(sourceWorkoutForNextPlan(), next);
  announce(`已减少一个动作：${removed.name}`);
}
```

If the existing normalizer rejects the new decision value, extend its allow-list with `reduced_exercise`; do not weaken other validation.

- [ ] **Step 3: Bind the dialog action**

Add delegated handling for `#removeNextWorkoutExerciseBtn` next to the existing recovery and self-decide actions.

- [ ] **Step 4: Run smoke tests**

Run: `npm.cmd run test:smoke`

Expected: all model and browser checks pass.

### Task 3: Responsive quality and delivery

**Files:**
- Modify: `public/styles.css`
- Modify: `public/app.js`, `public/app/index.html`, `public/sw.js`, `package.json`, `server.js`
- Test: `scripts/smoke-test.mjs`

**Interfaces:**
- Consumes: Task 2 markup.
- Produces: 390px-safe controls and a fresh offline cache.

- [ ] **Step 1: Add mobile assertions**

At 390px assert no horizontal overflow, every visible decision action is at least 44px high, and the last action is reachable by scrolling the dialog.

- [ ] **Step 2: Add minimal responsive CSS**

Use the existing `.next-plan-decision-actions` pattern; at narrow widths switch it to one column and set `min-height: 44px` on buttons.

- [ ] **Step 3: Set delivery version 1.22.0**

Set `APP_VERSION`, `package.json`, and the server default version to `1.22.0`. Set HTML and service-worker asset queries to `20260716-next-plan-edit-v1`, and set `CACHE_NAME` to `what-to-drill-shell-v20260716-next-plan-edit-v1`.

- [ ] **Step 4: Complete verification and commit**

Run:

```powershell
npm.cmd run check
npm.cmd run test:smoke
git diff --check
```

Expected: every command exits 0.

Commit only intended files with message: `Add editable next workout exercise removal`.
