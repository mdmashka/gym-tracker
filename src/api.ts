import type { AppData } from './types';
import { loadData, saveData } from './storage';
import { getTelegram } from './telegram';

// Public Supabase Edge Function URL. This is not a secret and is intentionally
// part of the client bundle, so Vercel does not need a public VITE_* env var.
const API_URL = 'https://jyywrpxetdfzjdqhebpj.supabase.co/functions/v1/api';

function hasTelegramSession() {
  return Boolean(API_URL && getTelegram()?.initData);
}

export const isRemoteConfigured = hasTelegramSession();

function headers() {
  const tg = getTelegram();
  return { Authorization: `tma ${tg?.initData ?? ''}` };
}

export async function getAppData(): Promise<AppData> {
  // Outside Telegram (local development / browser preview), use local storage.
  // The Supabase endpoint requires signed Telegram initData and must not block
  // the app when that data is unavailable.
  if (!hasTelegramSession()) return loadData();

  try {
    // Do not let a stalled network request leave the Mini App on the splash screen forever.
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${API_URL}`, { headers: headers(), signal: controller.signal });
      if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
      const data = await res.json() as AppData;
      data.workoutTypes = data.workoutTypes.map(t => t.id==='arms' ? {...t,name:'Руки и грудь'} : t.id==='back_shoulders' ? {...t,name:'Спина и плечи'} : t);
      saveData(data);
      return data;
    } finally {
      window.clearTimeout(timeout);
    }
  } catch (error) {
    console.warn('Remote data unavailable, using local cache:', error);
    return loadData();
  }
  }
}

export async function notifyTimerExpired(): Promise<void> {
  if (!hasTelegramSession()) return;
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'timer_expired' }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
}

export async function deleteRemoteWorkout(workoutId: string): Promise<void> {
  if (!hasTelegramSession()) return;
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete_workout', workoutId }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
}

export async function ensureMenuButton(): Promise<void> {
  if (!hasTelegramSession()) return;
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'ensure_menu_button', url: window.location.origin }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
}

export async function saveRemoteData(data: AppData): Promise<AppData> {
  // A workout marked completed without any recorded sets is an accidental empty record,
  // not a real workout. Remove such records before every sync so stale clients cannot
  // re-upload them after a server-side cleanup.
  const cleaned: AppData = {
    ...data,
    workouts: data.workouts.filter(w =>
      w.status !== 'completed' ||
      w.exercises.some(ex => ex.sets.length > 0)
    ),
  };
  // Always persist locally first. Remote sync must never be allowed to lose a workout.
  saveData(cleaned);
  if (!hasTelegramSession()) return cleaned;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${API_URL}`, {
        method: 'PUT',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(cleaned),
      });
      if (res.ok) return await res.json() as AppData;

      const message = await res.text();
      // Retry transient server/rate-limit failures; authentication/validation
      // errors should surface immediately instead of hammering the API.
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`API ${res.status}: ${message}`);
      }
      throw new Error(`API ${res.status}: ${message}`);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
