# Beginner Workout Execution v1 Design

## Goal

Make the workout tab feel like a guided beginner training session instead of a blank training database. The user should be able to start from the daily coach recommendation, follow a clear session structure, record sets with less hesitation, and finish with a simple summary.

This is the next commercial-quality step after Beginner Daily Coach v1. The daily coach answers "what should I do today"; this feature answers "how do I get through it without feeling lost?"

## Target User

The target user is still a fitness beginner. They may not know how many sets are enough, how hard RPE 6 should feel, or whether a session is complete. The interface should reduce uncertainty and avoid advanced training-log language unless it is explained by context.

## Product Positioning

This feature turns the workout tab into:

> A calm training companion for completing beginner sessions.

It should not become an advanced spreadsheet. It should preserve editable fields for flexibility, but the first impression should be a guided flow.

## Core Experience

When a user opens the workout tab, the page should show a "本次训练计划" execution panel above the existing workout form.

The panel should include:

- Session title and estimated duration.
- Current progress: planned exercises, recorded sets, and completion percentage.
- Training intent: normal, light, or recovery when the session came from the daily coach.
- Beginner cues: short notes such as "保留 3 次余力", "动作稳定优先", or "不追求极限重量".
- Primary action: finish and save workout.
- Secondary action: add another exercise.

The existing form and exercise cards remain available below. The design should make the current form feel like editable details, not the whole product.

## Execution State

Version 1 should avoid adding a complex timer or multi-step wizard. The execution state can be derived from the existing workout draft:

- Planned exercise count from cards.
- Recorded set count from cards.
- Total completed sets where weight, reps, or note is present.
- Average set RPE.
- Session RPE.
- Duration field.

Completion percentage:

- If the session was loaded from a template, planned sets are the total template sets.
- If there is no template context, planned sets are the current set rows.
- Completed sets are rows with reps, weight, or note.
- Clamp progress between 0% and 100%.

This should update live as the user edits the workout.

## Beginner Guidance

The execution panel should provide one short next action:

- No exercises: "先载入今日建议或添加第一个动作。"
- Exercises but few completed sets: "先完成每个动作的第一组，重量可以保守。"
- High RPE: "强度偏高，后面组数先别加量。"
- Nearly complete: "训练结构已经完整，可以保存并写一句备注。"
- Recovery session: "保持轻松，结束时应该感觉更松，不是更累。"

Exercise cards should keep the existing editable set rows, but the interface should make beginner defaults easier to read:

- Show the exercise index clearly.
- Keep note text visible after loading beginner templates.
- Preserve RPE defaults.
- Avoid forcing a required weight for recovery or bodyweight work.

## Finish Summary

After saving a workout, the user should get more than a toast. Version 1 should show a short local completion summary in the workout dashboard or a compact panel:

- Saved workout title.
- Total exercises and sets.
- Session RPE.
- One next suggestion, such as "下次可以保持同样重量" or "今天强度偏高，下次先维持。"

This summary should build confidence and connect the session back to future recommendations.

## Data Flow

Use existing local state:

- Draft workout data comes from the current form and exercise cards.
- Saved workouts continue to use `state.workouts`.
- Daily coach loaded templates can set visible draft metadata through existing form fields and notes.

No new persistent schema is required for v1. If implementation needs to know that a workout came from the daily coach, store that as a lightweight draft-only marker in the DOM or infer it from the workout title prefix "今日建议 -".

## Interface Design

The workout tab should move toward an execution hierarchy:

1. Session execution panel.
2. Editable session details.
3. Exercise list.
4. Template controls.

The current template toolbar can stay, but it should not be the first thing the user depends on when arriving from the daily coach.

Desktop layout should show progress, guidance, and actions in one row. Mobile layout should stack them with the main action full-width.

## Error And Empty States

If the workout draft is empty:

- Show a calm empty execution panel.
- Offer "载入今日建议" if a current daily coach recommendation exists.
- Keep "添加动作" available.

If the user tries to save without valid set data:

- Keep the existing validation.
- The execution panel should explain that at least one action and one set are needed.

If the session has very high RPE:

- Do not block saving.
- Add a cautionary suggestion in the summary.

## Testing And Verification

Implementation should be verified with:

- JavaScript syntax checks.
- Browser checks on desktop and mobile.
- Empty workout draft.
- Workout loaded from daily coach.
- Editing set rows updates progress.
- Saving workout shows completion summary.
- No horizontal overflow.

## Non-Goals

This version should not add:

- Rest timers.
- Exercise technique videos.
- Plate calculator.
- Wearable integrations.
- Advanced periodization.
- Social sharing.
- Paid subscription screens.

Those can come later. The immediate goal is to make the first guided training loop feel complete.

## Success Criteria

The feature is successful when a beginner can:

- Start a recommended workout.
- Understand what the session is trying to accomplish.
- See whether they are partway through or basically done.
- Save the session and receive a useful completion summary.

The workout tab should feel like a guided session, not a form waiting to be filled.
