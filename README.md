# Gym Tracker

Telegram Mini App built with React 19, TypeScript and Vite. The active web entrypoint is `src/bootstrap.tsx`; UI is in `src/main.tsx`. The deployable API is `supabase/functions/api/index.ts` (Deno). Root-level application copies are legacy and are not the web entrypoint.

## Local development

Use Node.js 24 and the checked-in npm lockfile:

```sh
npm ci
npm run dev -- --host 127.0.0.1
# Install Chromium for browser regressions if a system /usr/bin/chromium is unavailable:
npx playwright install chromium
npm run check
```

Outside Telegram the application uses browser localStorage. No bot token or database credentials are required. Never expose Supabase server keys or the bot token through `VITE_*` variables.

A Telegram session uses `VITE_API_URL` when supplied, otherwise the existing production endpoint. Do not open a Telegram-authenticated preview without an explicitly configured staging endpoint and a separate test bot.

## Data safety

The API returns an ETag derived from the existing `updated_at` column. Writes require `If-Match`; stale writes return 409, unversioned writes return 428. GET is read-only. Deletions use the same versioned write path. Unsynced changes are persisted immediately in a user-specific local pending snapshot; server reads do not discard them. A conflict retains the local copy for export/reconciliation rather than silently overwriting either journal.

`npm run check` runs ESLint, frontend/tests TypeScript, Deno backend type checking, Vitest regressions, the production build and mobile Chromium regressions. Regression tests use local fixtures, mocked HTTP and an in-memory repository, not production. They do not establish actual database RLS/grants.

## Release

This is a protocol change affecting old clients. Read [safe release instructions](docs/SAFE_RELEASE.md) before any deployment. No SQL migration is required by this change. The repository still has an unresolved `users` versus `profiles` schema mismatch; do not run existing migrations/import scripts to guess a correction.
