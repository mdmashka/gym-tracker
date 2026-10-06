# Safe development of Gym Tracker

Existing user data takes precedence over new features and refactoring.

- Inspect active architecture before changing it. The web entrypoint is `src/bootstrap.tsx`; application components are in `src/main.tsx`. The deployable Edge Function is `supabase/functions/api/index.ts`. Shared pure types/domain/defaults live in `supabase/functions/_shared` and are re-exported by the frontend. Root-level application copies are legacy, not the active frontend.
- Never modify production data, deployment, runtime variables, or bot configuration without explicit authorization for that operation. General coding approval is not production access approval.
- Never run destructive SQL, migrations, reset/seed/import helpers or data cleanup without explicit approval. Every schema change needs a reviewed migration and a tested recovery plan.
- Never reset existing users during onboarding. Preserve workouts, templates, exercises and historical names across updates.
- Preserve backward compatibility with stored data. Document protocol changes and their effect on older clients; never silently allow stale full-document replacement.
- Authorize server access only from validated Telegram initData. Every journal read/write must be scoped to the verified user. Never expose server keys.
- Keep preview/staging credentials and data separate from production. Do not call production API even for smoke tests: older GET handlers perform writes.
- Use the existing checkout. Cloud tasks are isolated; create a worktree only when explicitly requested.
- Every bug fix needs a meaningful regression test. Run `npm run check` before completion. Report failed or unrun checks, including backend/DB integration limitations.
- Do not discard unsynced local data to resolve conflicts. Preserve/export it and use an explicitly reviewed reconciliation workflow.
- Do not automatically merge, deploy or publish. Provide reviewable changes and release instructions first.
