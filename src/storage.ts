import type { AppData } from './types.ts';
import { isValidAppData } from './domain.ts';

export function userStorageKey() {
  const telegramUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  return telegramUserId ? `gym-log:data:v2:${telegramUserId}` : 'gym-log:data:v2:browser-demo';
}

import { blankData } from './defaults.ts';
export { blankData } from './defaults.ts';

export interface PendingData { data: AppData; baseVersion: string | null }

function parseData(raw: string): AppData {
  const value: unknown = JSON.parse(raw);
  if (!isValidAppData(value)) throw new Error('Локальные данные повреждены. Не очищайте хранилище; сохраните резервную копию.');
  return value;
}

export function loadCachedData(key = userStorageKey()): AppData | null {
  const raw = localStorage.getItem(key);
  return raw === null ? null : parseData(raw);
}

export function loadPending(key = userStorageKey()): PendingData | null {
  const raw = localStorage.getItem(`${key}:pending`);
  if (raw === null) return null;
  const value = JSON.parse(raw) as PendingData;
  if (!isValidAppData(value.data) || (value.baseVersion !== null && typeof value.baseVersion !== 'string')) {
    throw new Error('Не удалось прочитать несинхронизированные данные. Не очищайте хранилище.');
  }
  return value;
}

export function loadData(): AppData {
  return loadPending()?.data ?? loadCachedData() ?? blankData();
}

export function saveData(data: AppData, key = userStorageKey()) {
  localStorage.setItem(key, JSON.stringify(data));
}

export function stagePending(data: AppData, baseVersion: string | null, key = userStorageKey()) {
  // One atomic write preserves the latest snapshot before any network request.
  localStorage.setItem(`${key}:pending`, JSON.stringify({ data, baseVersion }));
}

export function acknowledge(data: AppData, version: string, key = userStorageKey()) {
  const pending = loadPending(key);
  saveData(data, key);
  if (!pending || JSON.stringify(pending.data) === JSON.stringify(data)) {
    localStorage.removeItem(`${key}:pending`);
  } else {
    stagePending(pending.data, version, key);
  }
}

export function resetDemo() {
  if (window.Telegram?.WebApp?.initData) throw new Error('Сброс данных Telegram-пользователя запрещён.');
  localStorage.removeItem(userStorageKey());
  localStorage.removeItem(`${userStorageKey()}:pending`);
  location.reload();
}
