import type { AppData } from './types';
import { acknowledge, loadCachedData, loadData, loadPending, saveData, stagePending, userStorageKey } from './storage';
import { isValidAppData } from './domain';
import { getTelegram } from './telegram';

const API_URL = import.meta.env.VITE_API_URL || 'https://jyywrpxetdfzjdqhebpj.supabase.co/functions/v1/api';
export type SyncState = 'local' | 'synced' | 'pending' | 'offline' | 'conflict';
let state: SyncState = 'local';
let version: string | null = null;
let key = '';
let initData = '';
let verifiedSession = false;
let observedPending: string | null = null;
export const getSyncState = () => state;

function checkSession() {
  if (key !== userStorageKey() || initData !== (getTelegram()?.initData ?? '')) {
    throw new Error('Аккаунт изменился. Перезапустите приложение перед сохранением.');
  }
}

async function request(options: RequestInit = {}) {
  checkSession();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(API_URL, { ...options, headers: { Authorization: `tma ${initData}`, ...options.headers }, signal: controller.signal });
    const body = await response.text(); // Keep the timeout active while the response body arrives.
    return new Response(body, { status: response.status, headers: response.headers });
  } finally { window.clearTimeout(timeout); }
}

function responseVersion(response: Response): string {
  const expectedUser = getTelegram()?.initDataUnsafe?.user?.id;
  if (!expectedUser || response.headers.get('X-Telegram-User-Id') !== String(expectedUser)) {
    throw new Error('Не удалось подтвердить владельца данных. Сохранение заблокировано.');
  }
  const value = response.headers.get('ETag');
  if (!value) throw new Error('Сервер не поддерживает безопасное сохранение. Требуется обновление API.');
  return value;
}

export async function getAppData(): Promise<AppData> {
  key = userStorageKey();
  initData = getTelegram()?.initData ?? '';
  version = null;
  verifiedSession = false;
  if (!initData) { state = 'local'; return loadData(); }
  observedPending = localStorage.getItem(`${key}:pending`);
  const pending = loadPending(key);
  try {
    const response = await request();
    if (!response.ok) throw new Error(`Не удалось загрузить журнал (${response.status}).`);
    const remoteVersion = responseVersion(response);
    const data: unknown = await response.json();
    if (!isValidAppData(data)) throw new Error('Сервер вернул некорректные данные.');
    checkSession();
    verifiedSession = true;
    if (pending) {
      // Never replace unsynced changes with a remote snapshot or silently rebase them.
      version = pending.baseVersion;
      state = version === remoteVersion ? 'pending' : 'conflict';
      return pending.data;
    }
    version = remoteVersion;
    saveData(data, key);
    state = 'synced';
    return data;
  } catch (error) {
    state = 'offline';
    version = pending?.baseVersion ?? null;
    const cached = pending?.data ?? loadCachedData(key);
    if (cached) return cached;
    throw error;
  }
}

export function stageData(data: AppData): void {
  checkSession();
  if (!isValidAppData(data)) throw new Error('Изменение содержит некорректные данные.');
  if (!initData) { saveData(data, key); return; }
  if(localStorage.getItem(`${key}:pending`)!==observedPending){
    state='conflict';
    throw new Error('Локальная копия изменена в другой вкладке. Перезапустите приложение; данные не перезаписаны.');
  }
  stagePending(data, version, key);
  observedPending=localStorage.getItem(`${key}:pending`);
  if (state !== 'conflict') state = 'pending';
}

export async function saveRemoteData(data: AppData): Promise<AppData> {
  checkSession();
  if (!initData) return data;
  if (!verifiedSession || state === 'conflict' || !version) {
    throw new Error('Синхронизация заблокирована: версия сервера неизвестна или изменилась. Локальная копия сохранена.');
  }
  try {
    const response = await request({ method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': version }, body: JSON.stringify(data) });
    if (response.status === 409 || response.status === 412) {
      state = 'conflict';
      throw new Error('Журнал изменён на другом устройстве. Локальная копия сохранена; автоматическая перезапись запрещена.');
    }
    if (!response.ok) throw new Error(`Сохранение не подтверждено сервером (${response.status}). Локальная копия сохранена.`);
    const nextVersion = responseVersion(response);
    const result: unknown = await response.json();
    if (!isValidAppData(result)) throw new Error('Сервер не подтвердил корректные данные.');
    checkSession();
    version = nextVersion;
    if(localStorage.getItem(`${key}:pending`)!==observedPending){
      state='conflict';
      throw new Error('Сервер принял запись, но локальная копия изменилась в другой вкладке. Обе версии сохранены.');
    }
    acknowledge(data, version, key);
    observedPending=localStorage.getItem(`${key}:pending`);
    state = loadPending(key) ? 'pending' : 'synced';
    return result;
  } catch (error) {
    if (state !== 'conflict') state = 'offline';
    throw error;
  }
}

export async function notifyTimerExpired(): Promise<void> {
  if (!initData) return;
  const response = await request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'timer_expired' }) });
  if (!response.ok) throw new Error('Уведомление таймера не отправлено.');
}
