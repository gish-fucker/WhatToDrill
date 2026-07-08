# Beginner Daily Coach v1 Implementation Plan

## Scope

Implement the approved beginner daily coach design as a local-first feature. The first version should make the Today tab open with a clear training recommendation and allow the user to start the suggested beginner workout.

## Steps

1. Add coach surface to Today
   - Add a `dailyCoach` section above the existing daily form.
   - Render status, suggested workout, reasons, caution, and actions.
   - Keep the existing form below the coach card.

2. Add local recommendation logic
   - Derive today's daily log from existing form values and saved state.
   - Read workouts from the last 7 days and hard workouts from the last 3 days.
   - Return one of three statuses: normal, light, recovery.
   - Prefer conservative advice when pain or fatigue is high.

3. Add beginner suggested templates
   - Define built-in beginner templates in app code.
   - Include full body, upper body, lower body, and recovery home sessions.
   - Use moderate sets, reps, and RPE targets.

4. Start workout from recommendation
   - Add a primary action that switches to the workout tab.
   - Prefill the workout editor with the recommended template.
   - Use a title that marks it as today's suggestion.

5. Style and responsive behavior
   - Match the existing calm product visual language.
   - Desktop should feel like a decision center, not another form.
   - Mobile should stack cleanly without horizontal overflow.

6. Verification
   - Run JavaScript syntax checks.
   - Check empty-state, normal, and recovery scenarios in Chrome.
   - Capture desktop and mobile screenshots.
   - Commit the implementation.
