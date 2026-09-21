# Gym Log — Telegram Mini App

A personal strength-training log designed around three workout templates.

### Data isolation
Each Telegram account has a separate record in `user_app_data`. The Edge Function validates Telegram Mini App `initData` before using the Telegram user ID. A user never receives another user’s history.

See `docs/PRIVACY_SETUP.md` for Supabase/Vercel setup and one-time history import.


## Vercel
The Supabase API URL is embedded in `src/api.ts` because it is public client configuration, not a secret. No Vercel environment variable is required.
