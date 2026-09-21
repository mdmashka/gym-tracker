# Gym Log — Product Specification

## Product goal
Fast personal strength-training log inside Telegram. The main workflow is: choose one of three workout types → see the most recent performance for that muscle-group workout → enter sets one by one → rest timer → finish workout.

## Workout types
1. Ноги
2. Руки
3. Спина + плечи

Each type has an editable template order. The template is normally followed, but an individual workout can skip or reorder exercises. An exercise can also be added for one workout only.

## Set data
Every set is its own row/object:
- weight: decimal or empty/null;
- reps: decimal or integer, required to save;
- comment: optional;
- loadMeta: future JSON extension for plates/sides/custom load types.

Do not force a weight step. Decimal weights such as 19.1, 20.3, 27.3, 29.6 are valid. Assisted exercises can use negative values, e.g. -9.

## Exercise load types
Configured per exercise, not per set-entry screen. Supported values:
- weight
- assisted
- dumbbell
- plate
- custom

The current v1 UI still exposes simple weight + reps fields and does not require the user to select load type while logging a set.

## Previous workout display
Inside an exercise, show results from the two latest completed occurrences of the same exercise within the same workout type. This is intentionally not a global per-exercise history query across other workout types.

Example: opening Руки on 21.09 should show the latest one or two Руки workouts containing that exercise, even when Ноги or Спина were done more recently.

## Logging interaction
- Opening a workout automatically opens the first incomplete/not-skipped exercise.
- Each saved set persists immediately.
- Default next set weight is the previous set's weight.
- "Скопировать" copies the previous set's weight, reps and comment into the input form.
- "Готово" closes the currently expanded exercise; it does not finish the whole workout.
- Saving a set starts a 2-minute rest timer.
- Timer supports +30 sec, -30 sec and finish/close. No pause button.
- Finishing the workout marks it completed.

## Home
Show exactly three workout choices immediately. Each item can show the last date for that workout type.
Secondary actions: calendar, summary, settings.

## Calendar
Month view. Completed workout days get a dot. Selecting a day opens the workout history.

## Summary
Separate screen, not shown while entering a workout.
Filter by workout type and optionally exercise. Show chronological exercise results without a large analytics layer.
No RPE/RIR/tonnage/PR requirements for v1.

## Export
- XLSX export of all history.
- CSV-compatible export helper remains available in code.
- PDF is provided through a print-optimized view and the browser/Telegram WebView print flow (Save as PDF).

## Legacy import
The supplied workbook `Тренировки.xlsx` is already transformed into `data/legacy_seed.json`.
Safe patterns are parsed into individual sets: `12*3`, `12,10,10`, `12`.
Ambiguous strings are retained as notes rather than guessed.

The seed currently contains 27 historical workouts and 24 exercises across the three workout types.

## Data model
Postgres tables:
- profiles
- workout_types
- exercises
- workouts
- workout_exercises
- workout_sets

Client-side IDs are persisted as `client_id` to make sync idempotent.

## Security
The frontend sends the raw Telegram Mini App `initData` to the Edge Function. The server verifies its HMAC using the bot token and rejects missing/invalid/stale data before using the service role for DB access.
Never trust `initDataUnsafe` for authentication or authorization.

## Stack
- React 19 + TypeScript
- Vite
- Supabase Postgres
- Supabase Edge Function (Deno/TypeScript)
- Telegram Mini Apps WebApp SDK script
