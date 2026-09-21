import fs from 'node:fs';

const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const telegramUserId = process.env.TELEGRAM_USER_ID;
if (!url || !key || !telegramUserId) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and TELEGRAM_USER_ID first.');
  process.exit(1);
}

const seed = JSON.parse(fs.readFileSync(new URL('../data/legacy_seed.json', import.meta.url), 'utf8'));
const workoutTypes = seed.workout_types.map((x) => ({ id: x.id, name: x.name, slug: x.slug }));
const exercises = seed.exercises.map((x) => ({
  id: x.id,
  workoutTypeId: x.workout_type_id,
  name: x.name,
  loadType: x.load_type ?? 'weight',
  sortOrder: x.sort_order,
  isActive: true,
}));
const workouts = seed.workouts.map((w) => ({
  id: w.id,
  typeId: w.workout_type_id,
  date: w.date,
  status: 'completed',
  createdAt: new Date(`${w.date}T12:00:00`).toISOString(),
  exercises: w.exercises.map((e, idx) => ({
    id: `${w.id}-${idx}`,
    exerciseId: e.exercise_id,
    order: idx + 1,
    skipped: false,
    notes: e.legacy_note ?? undefined,
    sets: (e.sets ?? []).map((set) => ({
      id: `${w.id}-${idx}-${set.order}`,
      order: set.order,
      weight: e.weight,
      reps: set.reps,
      comment: e.legacy_note ?? undefined,
    })),
  })),
}));

const body = {
  telegram_user_id: Number(telegramUserId),
  data: { workoutTypes, exercises, workouts },
  updated_at: new Date().toISOString(),
};

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates,return=minimal',
};

let response = await fetch(`${url}/rest/v1/profiles?on_conflict=telegram_user_id`, {
  method: 'POST', headers,
  body: JSON.stringify({ telegram_user_id: Number(telegramUserId) }),
});
if (!response.ok && response.status !== 409) {
  console.error('Profile insert failed:', response.status, await response.text()); process.exit(1);
}

response = await fetch(`${url}/rest/v1/user_app_data?on_conflict=telegram_user_id`, {
  method: 'POST', headers,
  body: JSON.stringify(body),
});
if (!response.ok) {
  console.error('History import failed:', response.status, await response.text()); process.exit(1);
}
console.log(`Imported ${workouts.length} workouts and ${exercises.length} exercises for Telegram user ${telegramUserId}.`);
