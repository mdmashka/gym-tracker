# Review and safe release of data-preservation fixes

These changes are prepared locally. They do not authorize or perform deployment, database changes, configuration edits or merging.

## What changed

- Existing persisted journals are not returned to onboarding, even if an old stored flag is false. Customized local journals also bypass the first-run wizard. Untouched new defaults with an explicit false flag still receive onboarding. Completion does not clear existing workouts or their templates/exercises.
- Failed remote reads do not fabricate a new Telegram user. Existing local data may remain available, but unverified writes are blocked.
- Every journal write requires the ETag from a verified read, with a database UPDATE predicate on both owner ID and `updated_at`. No revision column/migration is introduced.
- Pending edits are stored before entering the network queue. Failed/conflicting saves retain them and do not report server success. Reload preserves pending edits.
- Workout deletion uses versioned PUT, not a competing read/filter/upsert POST.
- User requests can no longer configure the bot menu.
- Empty completed workouts are not implicitly deleted. Zero-template users can create a template. Historical custom exercise names/sets are rendered.

## Compatibility and release gates

The new frontend requires ETag and X-Telegram-User-Id response headers. The new backend rejects old unversioned PUTs and legacy delete_workout POSTs with 428. This is deliberate protection against silent data replacement, not fully seamless backward compatibility. Old clients may retain edits only according to their old cache behavior: no claim of retroactive protection is made. In particular, a user finishing destructive onboarding in an old client can still lose that client's local cache even when the new backend rejects its PUT.

Do not deploy the frontend independently against the old backend or roll the backend back to the unsafe implementation. Do not let CI or Vercel auto-publish this branch without explicit approval.

Before a production release:

1. With separately authorized read-only access, identify the actual deployed commit, `user_app_data` foreign key, identity table, unique keys, updated_at behavior, RLS, grants and any triggers. Confirm every writer is inventoried, including imports, legacy functions and external tools. The CAS invariant only holds while all writers participate and advance the version. Existing `users`/`profiles` migrations are inconsistent; do not execute them as a shortcut.
2. Confirm a recoverable backup/PITR and rehearse restore on isolated data. Record how to export current and pending local snapshots without putting real user data into this repository or CI.
3. Use a separate staging Supabase project and Telegram bot. Configure the preview endpoint explicitly. Shared pure types/domain/defaults are under `supabase/functions/_shared`; the frontend re-exports them. Check the staging function bundle includes this standard shared module graph.
4. Run npm ci, install the Playwright Chromium runtime if a system Chromium is unavailable, and run npm run check. Then exercise A-G from the audit against the real staging database, including two independent users, new-user identity/FK creation, concurrent database writes and direct Data API policies. In-memory tests do not replace those checks.
5. Verify deployment order and cached-client handling in staging: backend first closes unsafe writes; frontend immediately follows. Inform users to reopen/update the app; retain local pending copies. If interruptions are unacceptable, prepare and test a separate transition release before deployment.
6. After separately approved publication, verify two test accounts and observe errors/conflicts. Do not use actual customer data as test fixtures.

There is no production credentials setup, bot menu update, SQL, import, database cleanup or deployment command in this document to run automatically.

## Conflict recovery

A mismatched/unknown base version is intentionally not auto-merged. Download the local JSON backup and preserve the current server version before considering reconciliation. The UI offers retry for network failures, but retry never overrides a version conflict. Automatic conflict merging/restoration is not implemented. This is a separate task with regression tests and explicit user intent.

## Remaining limitations

- Production RLS/grants and the users/profiles schema mismatch are unverified and unchanged.
- The timestamp CAS adapter is type-checked but requires real Postgres concurrency/trigger testing in staging.
- A single user-specific pending snapshot is retained per browser origin; the client detects a pending snapshot changed by another tab and refuses to overwrite it. This read/check/write guard is not an atomic cross-process lock: a fully concurrent race still needs a separate ownership/coordination mechanism. Server conflicts do not imply that browser storage is a multi-writer database.
- Timer notifications still need a distributed abuse/rate-limit policy before they can be claimed resistant to spam.
- Import helpers and root-level legacy copies remain present. They are not safe recovery tools and must not be deployed/run accidentally.
- No staging infrastructure, branch protection or Vercel settings have been changed. The GitHub workflow is a prepared file; its remote execution has not been observed.

## Regression coverage

The suite covers new onboarding to calendar, legacy reload preservation, create/edit/delete/zero-template recovery, precise set persistence, custom exercise history, failed saves/template switching, durable pending storage, HTTP failures/timeouts, stale writes/deletes, first-write races, Telegram HMAC and A/B isolation at the handler boundary. Mobile Chromium additionally verifies actual pointer hit testing with the timer open, precise calendar/history restoration, legacy reload and last-template recovery. External requests are blocked in browser tests. All fixtures are synthetic. Production security is not inferred from these tests.

## Local validation evidence

On the prepared Node 24 / Deno 2.9 environment, `npm run check` completed successfully:

- ESLint for active source, backend, tests and configs.
- TypeScript for frontend and tests; Deno type check for the actual Edge Function entrypoint with the frozen lockfile.
- 51 Vitest tests passed; no skipped or disabled tests.
- Production build passed; the existing >500 kB bundle warning remains.
- 3 mobile Chromium browser regressions passed, with external network access blocked.

This validates local code and synthetic workflows. It does not establish production schema, RLS/grants, actual Supabase database concurrency, remote CI execution or publication. No SQL files were changed and no migration, production API request, bot API call, merge or deployment was performed during these changes.
