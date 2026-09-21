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
    const res = await fetch(`${API_URL}`, { headers: headers() });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    const data = await res.json() as AppData;
    saveData(data);
    return data;
  } catch (error) {
    // A network/API outage must not make an already usable local journal
    // impossible to open.
    const local = loadData();
    if (local.workouts.length || local.exercises.length) return local;
    throw error;
  }
}

export async function saveRemoteData(data: AppData): Promise<AppData> {
  // Always persist locally first. This also makes drafts survive a reload.
  saveData(data);

  if (!hasTelegramSession()) return data;

  const res = await fetch(`${API_URL}`, {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);

  // Do not write the response back to localStorage: several quick saves can
  // complete out of order, and an older response must never overwrite newer
  // local data.
  return await res.json() as AppData;
}
