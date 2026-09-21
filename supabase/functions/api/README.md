# User-isolated API

This function authenticates each Telegram Mini App request using `Telegram.WebApp.initData`, then reads/writes only the row keyed by the validated Telegram user ID.

Required Supabase secrets:

- `TELEGRAM_BOT_TOKEN`
- `SUPABASE_SERVICE_ROLE_KEY` (Supabase injects `SUPABASE_URL` automatically)

The browser must never receive the service role key.
