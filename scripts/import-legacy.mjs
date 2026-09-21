/*
  Optional production import helper.

  The current app already ships with data/legacy_seed.json generated from the user's
  workbook. This script is intentionally a small placeholder: the recommended
  first production sync is performed by the Mini App after Telegram auth.
*/
import fs from 'node:fs';
const data=JSON.parse(fs.readFileSync(new URL('../data/legacy_seed.json', import.meta.url),'utf8'));
console.log(`Legacy seed: ${data.workouts.length} workouts, ${data.exercises.length} exercises.`);
console.log('Open the Mini App once with VITE_API_URL configured to sync the seed into Supabase.');
