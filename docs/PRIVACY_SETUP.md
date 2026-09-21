# User-specific data setup

The Mini App is designed so each Telegram user has a separate `user_app_data` row. The API validates Telegram `initData` and uses the validated Telegram user ID as the storage key. This follows Telegram’s requirement to validate `initData` on the server before trusting user identity.

## 1. Supabase

Run these migrations in order:

- `supabase/migrations/001_init.sql`
- `supabase/migrations/002_user_app_data.sql`

Deploy the `api` Edge Function and add these Edge Function secrets:

- `TELEGRAM_BOT_TOKEN` — your BotFather token
- `SUPABASE_SERVICE_ROLE_KEY` — never put this in Vercel/browser code

## 2. Vercel

Set the environment variable:

`VITE_API_URL=https://YOUR_PROJECT_ID.supabase.co/functions/v1/api`

Redeploy. The production app must have this variable set.

## 3. Import your existing history

The deployable app does not contain your personal training history. Use `scripts/import-owner.mjs` on your own computer once:

```bash
SUPABASE_URL="https://YOUR_PROJECT_ID.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="YOUR_SECRET_KEY" \
TELEGRAM_USER_ID="YOUR_TELEGRAM_NUMERIC_ID" \
node scripts/import-owner.mjs
```

This creates/updates only the row for that Telegram ID. Other users receive clean default templates when they first open the Mini App.
