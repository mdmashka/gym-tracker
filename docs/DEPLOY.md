# Deployment checklist

## 1. Telegram
Create the bot in `@BotFather` and keep the bot token private.
Create/assign a Mini App URL served over HTTPS.

## 2. Supabase
Create a project and run:

```sql
supabase/migrations/001_init.sql
```

Deploy the Edge Function `supabase/functions/api` and configure:

```text
TELEGRAM_BOT_TOKEN=...
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

The function deliberately validates Telegram `initData` itself. `verify_jwt=false` is expected for this endpoint because Telegram Mini App auth is handled at the function boundary.

## 3. Frontend
Create `.env`:

```text
VITE_API_URL=https://<project>.supabase.co/functions/v1/api
```

Build:

```bash
npm install
npm run build
```

Deploy `dist/` to an HTTPS static host.

## 4. First launch
On the first production launch, a user with an empty database receives the bundled legacy seed and the app syncs it to Supabase. Subsequent writes are idempotent by `client_id`.

## Secrets
Never put the Telegram bot token or Supabase service role key in `VITE_*` variables or frontend source.
