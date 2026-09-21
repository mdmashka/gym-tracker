import type { AppData } from './types';
import { loadData, saveData } from './storage';
import { getTelegram } from './telegram';

// Public Supabase Edge Function URL. This is not a secret and is intentionally
// part of the client bundle, so Vercel does not need a public VITE_* env var.
const API_URL = 'https://jyywrpxetdfzjdqhebpj.supabase.co/functions/v1/api';
export const isRemoteConfigured = Boolean(API_URL);

function headers() {
  const tg = getTelegram();
  return { Authorization: `tma ${tg?.initData ?? ''}` };
}

export async function getAppData(): Promise<AppData> {
  if (!API_URL) return loadData();
  const res = await fetch(`${API_URL}/data`, { headers: headers() });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json() as AppData;
  saveData(data);
  return data;
}

export async function saveRemoteData(data: AppData): Promise<AppData> {
  saveData(data);
  if (!API_URL) return data;
  const res = await fetch(`${API_URL}/data`, {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const result = await res.json() as AppData;
  saveData(result);
  return result;
}
