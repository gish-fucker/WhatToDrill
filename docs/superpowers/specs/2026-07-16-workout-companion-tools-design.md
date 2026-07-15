# Workout Companion Tools Design

## Context

The user feedback identifies the focused set-by-set workout flow as one of the product's strongest areas, but it still requires too much repeated input and offers little help between sets. The next improvement should strengthen the workout itself before adding more analysis surfaces.

This design covers the seven missing high-frequency tools called out in the feedback:

1. Rest timing between sets.
2. Weight `-2.5 / +2.5` controls.
3. Repetition `-1 / +1` controls.
4. Reusing the previous completed set's weight.
5. Completion feedback through vibration where supported.
6. Keeping the screen awake during an active workout where supported.
7. A clearer transition to the next exercise.

## Goal

Make each set require less typing and make the time between sets feel guided without turning the focused workout into a dense control panel.

The intended loop is:

> complete a set → see the rest countdown and what comes next → adjust only what changed → complete the next set

The features must remain local-first, work without a network connection, and degrade safely when optional browser APIs are unavailable.

## Product Principles

- The workout remains usable if every companion feature fails.
- Automation supplies defaults but never blocks or overrides the user.
- The current set stays visually dominant; timing and transition information are supporting context.
- Browser capabilities such as vibration and wake lock are enhancements, not requirements.
- A restored draft must remain internally consistent with completed, skipped, pending, and undone sets.

## User Experience

### Completing A Set

When the user completes a set and another pending set remains:

- The set is saved immediately using the existing draft persistence.
- A 90-second rest countdown starts automatically.
- The next pending set becomes the current set immediately, so the user can continue without waiting.
- A compact rest panel appears above the current set with the remaining time and the next action.
- The device gives one short vibration when supported.

The timer never disables the current inputs or the completion action. A user who does not want to rest can start the next set immediately.

When no pending set remains, no rest timer starts. The existing workout completion state is shown instead.

### Rest Timer

The rest panel contains:

- Remaining time in `mm:ss` format.
- Context such as `下一组：卧推 · 第 2 组` or `下一动作：坐姿划船`.
- `+30 秒`.
- `跳过休息`.
- `重新计时`.

The default duration is 90 seconds. `+30 秒` changes the current countdown only. `重新计时` resets it to 90 seconds. This phase does not add a settings screen or per-exercise timer presets.

The countdown is computed from an absolute end timestamp rather than decrementing a stored integer. This prevents drift when rendering is delayed or the tab is temporarily hidden.

If a draft is restored while its countdown is still active, the remaining time resumes. If the countdown expired while the application was closed or hidden, the UI shows `休息完成，可以继续` but does not vibrate unexpectedly on restoration.

### Quick Input Controls

The focused repetition input adds adjacent `−1` and `+1` buttons for repetition-based sets. Seconds, minutes, and completion-only sets keep their existing input behavior.

The focused weight input adds adjacent `−2.5` and `+2.5` buttons:

- Values never go below zero.
- A blank value uses the displayed inherited or target value as its starting point.
- Each button click updates and persists the current pending set.
- Direct keyboard entry remains available.
- The controls affect only the current set, not the template or future plan.

Every quick-control button has an explicit accessible name and a minimum 44px touch target.

### Previous-Set Weight

When a pending set becomes current and has no actual weight, the application looks backward within the same exercise for the nearest completed set with a usable weight.

- If found, that completed value becomes the current set's prefilled actual weight.
- Otherwise the planned target weight remains the default.
- Values from skipped sets or other exercises are never reused.
- A user's existing actual value is never overwritten.
- Undoing a previous set does not erase a weight that the user has already edited in the current set.

This prefill is persisted in the workout draft but does not mark the set complete.

### Next-Exercise Transition

When the completed set was the final pending set of its exercise and the next pending set belongs to a different exercise, the rest panel uses a stronger transition message:

> 下一动作：坐姿划船

The next exercise name and its first-set target are visible before the user reaches it. After the timer ends or is skipped, the same transition remains as a short `接下来` label above the current set until the user edits or completes it.

Normal within-exercise transitions use the quieter `下一组` wording.

### Vibration Feedback

When `navigator.vibrate` is available:

- Completing a set triggers one short pulse.
- A rest timer reaching zero while the page is visible triggers two short pulses.

No sound is added in this phase. Vibration failures are ignored and never surface an error. An expired timer restored later does not trigger vibration.

### Screen Wake Lock

When the Screen Wake Lock API is available, the application requests a screen wake lock while all of the following are true:

- A focused workout session is active.
- The workout page is visible.
- The document is visible.

The lock is released when the user leaves the workout page, finishes or abandons the session, or the document becomes hidden. When the document becomes visible again during the active workout, the application may request a new lock.

Permission denial, API absence, or automatic browser release does not interrupt the workout and does not show repeated error messages.

## State And Data Model

The workout session model advances from version 2 to version 3. The new optional `companion` object contains only durable workout-companion state:

```js
{
  rest: {
    sourceSetId: "set-id",
    startedAt: "ISO timestamp",
    endsAt: "ISO timestamp"
  } | null,
  transition: {
    sourceSetId: "set-id",
    targetSetId: "set-id",
    kind: "set" | "exercise"
  } | null
}
```

Wake-lock handles, countdown intervals, vibration bookkeeping, and DOM state are never serialized.

Version 1 and version 2 drafts migrate to version 3 with an empty companion state. Existing rotation metadata remains attached by the application after model migration, as it is today.

The session model exposes pure operations for:

- Completing a set and creating the appropriate rest/transition state.
- Adjusting, resetting, or clearing a rest timer.
- Calculating remaining seconds from a supplied time.
- Prefilling weight from the nearest completed set in the same exercise.
- Clearing companion state when undo or manual set selection invalidates it.

All time-dependent helpers accept an explicit timestamp in tests.

## Application Responsibilities

`public/workout-session-model.js` owns session consistency and pure state transitions.

`public/app.js` owns:

- Rendering the rest panel and quick controls.
- Running and cleaning up the countdown interval.
- Calling vibration and wake-lock browser APIs.
- Responding to document visibility and tab changes.
- Persisting the updated session through the existing workout-draft path.

The service worker continues caching the existing session model and application assets. A cache-version change ensures installed PWAs receive the new interface.

## Edge Cases And Error Handling

- Completing the final pending set does not create a timer.
- Skipping a set does not trigger rest or vibration.
- Undoing the set that started the timer clears that timer and returns focus to the undone set.
- Selecting another set manually clears stale transition context but does not alter completed data.
- Repeated completion clicks cannot start multiple intervals because the completed set is no longer pending and the existing interval is replaced.
- Weight decrement stops at zero; invalid typed values continue through existing numeric normalization.
- If local storage fails, the existing storage-health message remains authoritative.
- If wake lock is released by the browser, the application removes its stale handle and retries only after a relevant visibility or tab event.
- Timer updates do not rerender the entire workout every second; only the timer text and state are updated.

## Accessibility And Mobile Behavior

- The timer is visually updated every second, but screen readers receive only meaningful state changes such as `休息开始` and `休息完成`, not an announcement every second.
- Quick controls have descriptive labels such as `重量减少 2.5 千克`.
- Keyboard users can continue using the numeric inputs directly.
- Focus remains on the next current-set card after completion, consistent with the existing flow.
- On narrow screens, quick controls form a single compact row around each value and never force horizontal scrolling.
- Reduced-motion preferences remain respected; no animated countdown ring is required.

## Testing

### Model Tests

Add coverage for:

- Version 1 and 2 draft migration to version 3.
- Rest state creation after a completed set and absence after the final set.
- Absolute-time remaining calculations.
- Add-time, reset, skip, undo, and manual-selection behavior.
- Same-exercise completed-weight inheritance.
- Ignoring skipped sets, other exercises, and existing actual values.
- Exercise versus set transition classification.

### Browser Smoke Tests

Verify:

- Completing a set starts a 90-second timer and moves to the next set.
- `+30 秒`, reset, and skip update the timer correctly.
- Quick weight and repetition controls persist values.
- The next set inherits only the correct previous weight.
- The final set of an exercise shows `下一动作` with the correct exercise.
- Undo clears the timer and restores the completed set.
- Unsupported vibration and wake-lock APIs do not cause console errors.
- A supported wake-lock stub is requested and released at the correct lifecycle points.
- Rest state survives a draft reload without duplicate alerts.
- Desktop and 390px mobile layouts have no horizontal overflow.

### Manual Browser Verification

Use a fresh local profile to complete at least one multi-exercise session on desktop and at 390px width. Inspect the countdown, quick controls, next-exercise transition, focus behavior, console output, and layout. Browser API behavior that cannot be exercised on the host device is verified with controlled stubs in the smoke suite.

## Non-Goals

This phase does not add:

- Per-exercise rest presets or a global timer settings page.
- Audio cues.
- Background notifications when the application is closed.
- Plate calculation.
- Exercise technique media.
- Wearable integration.
- Changes to training rotation, progress reports, onboarding, cloud backup, or payment.

Those remaining feedback items stay in the broader sequential product-improvement plan and receive separate designs and verification.

## Acceptance Criteria

- All seven high-frequency workout needs in the feedback have a working user-facing response.
- A user can complete consecutive sets with quick adjustments and no required repeated weight typing.
- Rest timing guides but never blocks the workout.
- Draft restore, skip, undo, manual set selection, and final completion remain consistent.
- Unsupported browser capabilities fail silently without weakening core recording.
- Existing workout history, training rotation, draft persistence, import/export, and offline operation continue to work.
- Automated checks and real desktop/mobile browser verification pass without console errors or horizontal overflow.
