# Beginner Onboarding v1 Implementation Plan

## Scope

Implement the approved beginner onboarding design by replacing the generic starter guide with a compact activation panel for first-time users.

## Steps

1. Render activation panel
   - Reuse `starterGuide` as the onboarding mount.
   - Show only when there are no daily logs and no workouts.
   - Include promise, checklist, primary action, secondary action, and privacy note.

2. Track checklist state
   - Sleep complete when a value is entered.
   - Energy, soreness, and pain complete after user interaction or after saving daily state.
   - Keep the state in memory for v1.

3. Add onboarding actions
   - Primary action scrolls to the daily form and highlights key fields.
   - Secondary action scrolls to the daily coach.
   - Existing daily coach start-workout action stays available.

4. Style onboarding and highlights
   - Match current restrained card style.
   - Use checklist rows, not large tutorial cards.
   - Make mobile layout stack cleanly.

5. Verification
   - Update smoke test to assert onboarding appears for empty state.
   - Verify saving daily log hides onboarding.
   - Verify no horizontal overflow on desktop/mobile.
