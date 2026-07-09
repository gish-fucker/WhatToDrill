# Beginner Workout Execution v1 Implementation Plan

## Scope

Implement the guided workout execution surface described in `2026-07-09-beginner-workout-execution-design.md`.

## Steps

1. Add execution surface
   - Add a `workoutExecution` section above the current workout dashboard.
   - Render title, duration, intent, progress, next action, and buttons.

2. Derive progress from draft workout
   - Count planned exercises and planned set rows.
   - Count completed sets where weight, reps, or note is filled.
   - Calculate completion percentage and average set RPE.
   - Update live when the workout form or exercise rows change.

3. Support daily coach continuation
   - Detect sessions loaded from the daily coach by the title prefix `今日建议 -`.
   - Offer a "载入今日建议" action when the draft is empty.
   - Keep "添加动作" available as the secondary action.

4. Add finish summary
   - Store the most recently saved workout summary in memory for the current session.
   - Render saved workout title, exercise count, set count, session RPE, and a next suggestion.
   - Keep existing save behavior and validation.

5. Style responsive layout
   - Match the current quiet product language.
   - Desktop: progress, guidance, and actions in a compact decision panel.
   - Mobile: stacked layout with full-width main actions.

6. Verify
   - Run JavaScript syntax checks.
   - Check empty draft, loaded daily coach workout, progress updates, save summary.
   - Capture desktop and mobile screenshots.
   - Confirm no horizontal overflow.
