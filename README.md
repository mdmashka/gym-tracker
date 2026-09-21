# Supabase setup

1. Run `migrations/001_init.sql` and `migrations/002_user_app_data.sql` in the Supabase SQL Editor.
2. Deploy the `api` Edge Function.
3. Set the Edge Function secrets `TELEGRAM_BOT_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY`.
4. Set Vercel environment variable `VITE_API_URL` to `https://YOUR_PROJECT_ID.supabase.co/functions/v1/api`.

Each Mini App request is authenticated from Telegram `initData`; data is stored under the validated Telegram user ID. A new Telegram user receives a blank set of workout templates and cannot see another user's workout history.
