You are implementing a production-minded personal Telegram Mini App called Gym Log.

Read `docs/SPEC.md` first. Preserve the requirements exactly. The repository already contains a working React/Vite UI, legacy seed data, SQL migration, and a Supabase Edge Function. Continue from the existing files instead of replacing the architecture with mock-only code.

Priorities:
1. Fast one-handed workout logging.
2. The previous one/two workout results for the same exercise within the same workout type are visible while entering a workout.
3. Each set saves immediately.
4. 2-minute rest timer starts after each saved set; +/- 30 seconds; no pause.
5. Three home workout choices: Ноги, Руки, Спина + плечи.
6. Skip/reorder exercises per workout.
7. Add an exercise for one workout without permanently adding it to the template.
8. Editable persistent workout templates.
9. Calendar and separate summary/history screens.
10. XLSX export and print-to-PDF.
11. Telegram theme and safe Mini App auth.

Do not add RPE/RIR, calories, social features or complex analytics unless explicitly requested later.

When making backend changes, keep the API based on validated Telegram initData. Never authenticate from initDataUnsafe. Keep `client_id` fields so sync is idempotent.

When improving UI, keep the visual language minimal, clean and close to a native Telegram/iOS utility: rounded cards, compact typography, theme variables, minimal taps, no decorative dashboards.

After implementation:
- run TypeScript/build checks when dependencies are available;
- verify the three workout templates and imported historical data;
- verify that a saved set starts the rest timer;
- verify that a completed workout is discoverable by calendar and summary;
- verify XLSX export and print styling;
- do not commit secrets.
