import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPending, saveData, userStorageKey } from '../src/storage';
import { journal } from './fixtures';

function telegram(id = 101) {
  window.Telegram = { WebApp: { initData: `signed-${id}`, initDataUnsafe: { user: { id } } } } as NonNullable<Window['Telegram']>;
}
const response = (data: import('../src/types').AppData = journal(), version = '"v1"', id = 101) => new Response(JSON.stringify(data), { headers: { ETag: version, 'X-Telegram-User-Id': String(id) } });
beforeEach(() => { localStorage.clear();telegram();vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals();vi.useRealTimers();delete window.Telegram; });

describe('durable client synchronization', () => {
  it('never treats a failed first GET as a new Telegram user', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network'));vi.stubGlobal('fetch', fetch);
    const api = await import('../src/api');
    await expect(api.getAppData()).rejects.toThrow('network');
    expect(localStorage.length).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps a real cached journal offline and blocks writes with an unknown version', async () => {
    const data = journal();saveData(data);
    const fetch = vi.fn().mockRejectedValue(new Error('network'));vi.stubGlobal('fetch', fetch);
    const api = await import('../src/api');
    expect(await api.getAppData()).toEqual(data);
    api.stageData(data);
    await expect(api.saveRemoteData(data)).rejects.toThrow('версия');
    expect(loadPending()?.data).toEqual(data);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('persists the newest edit while an earlier PUT is still pending and advances its base', async () => {
    let resolve!: (r: Response) => void;
    const fetch = vi.fn().mockResolvedValueOnce(response()).mockImplementationOnce(() => new Promise<Response>(r => resolve = r)).mockResolvedValueOnce(response(journal(), '"v3"'));
    vi.stubGlobal('fetch', fetch);
    const api = await import('../src/api');await api.getAppData();
    const first = journal();first.workouts[0].name = 'first';api.stageData(first);
    const saving = api.saveRemoteData(first);
    const second = { ...first, workouts: first.workouts.map(w => ({ ...w, name: 'latest' })) };api.stageData(second);
    expect(loadPending()?.data.workouts[0].name).toBe('latest');
    resolve(response(first, '"v2"'));await saving;
    expect(loadPending()).toEqual({ data: second, baseVersion: '"v2"' });
    await api.saveRemoteData(second);
    expect(fetch.mock.calls[2][1].headers['If-Match']).toBe('"v2"');
    expect(loadPending()).toBeNull();
  });
  it('preserves pending data after reload and refuses to rebase a conflict silently', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response(journal(), '"newer"'));vi.stubGlobal('fetch', fetch);
    let api = await import('../src/api');await api.getAppData();
    const pending = journal();pending.workouts[0].name = 'unsynced';api.stageData(pending);
    vi.resetModules();api = await import('../src/api');
    expect(await api.getAppData()).toEqual(pending);
    expect(api.getSyncState()).toBe('conflict');
    await expect(api.saveRemoteData(pending)).rejects.toThrow('заблокирована');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(loadPending()?.data).toEqual(pending);
  });
  it('returns pending changes even when the server has the same older base snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response()));
    let api = await import('../src/api');await api.getAppData();
    const pending = journal();pending.workouts[0].name = 'unsynced';api.stageData(pending);
    vi.resetModules();api = await import('../src/api');
    expect(await api.getAppData()).toEqual(pending);
    expect(api.getSyncState()).toBe('pending');
  });
  it.each([401, 400, 409, 500])('does not retry or discard data on HTTP %s', async status => {
    const fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response('{}', { status }));vi.stubGlobal('fetch', fetch);
    const api = await import('../src/api');await api.getAppData();
    const data = journal();api.stageData(data);
    await expect(api.saveRemoteData(data)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(loadPending()?.data).toEqual(data);
    expect(api.getSyncState()).toBe(status === 409 ? 'conflict' : 'offline');
  });
  it('checks the server-confirmed owner before caching a journal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(journal(), '"v1"', 202)));
    const api = await import('../src/api');
    await expect(api.getAppData()).rejects.toThrow('владельца');
    expect(localStorage.length).toBe(0);
  });
  it('refuses writes after the Telegram account changes', async () => {
    const fetch = vi.fn().mockResolvedValue(response());vi.stubGlobal('fetch', fetch);
    const api = await import('../src/api');await api.getAppData();
    const oldKey = userStorageKey();telegram(202);
    expect(() => api.stageData(journal())).toThrow('Аккаунт');
    expect(localStorage.getItem(`${oldKey}:pending`)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('aborts a stalled PUT and keeps the durable local snapshot', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response()).mockImplementationOnce((_url, opts) => new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted'))))));
    const api = await import('../src/api');await api.getAppData();
    const data = journal();api.stageData(data);
    const rejected = expect(api.saveRemoteData(data)).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(8000);await rejected;
    expect(loadPending()?.data).toEqual(data);
  });
  it('preserves completed workouts with no sets during unrelated saves', async () => {
    const data = journal();data.workouts[0].exercises.forEach(e => e.sets = []);
    const fetch = vi.fn().mockResolvedValueOnce(response(data)).mockResolvedValueOnce(response(data, '"v2"'));vi.stubGlobal('fetch', fetch);
    const api = await import('../src/api');await api.getAppData();api.stageData(data);await api.saveRemoteData(data);
    expect(JSON.parse(fetch.mock.calls[1][1].body).workouts).toEqual(data.workouts);
  });
  it('does not replace corrupt local data with defaults', async () => {
    localStorage.setItem(userStorageKey(), '{broken');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const api = await import('../src/api');await expect(api.getAppData()).rejects.toThrow();
    expect(localStorage.getItem(userStorageKey())).toBe('{broken');
  });
});

describe('verified identity is required before any write', () => {
  it('does not send a cached A journal with a B credential after owner validation fails', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response(journal(), '"v1"', 202));
    vi.stubGlobal('fetch', fetch);
    let api = await import('../src/api');await api.getAppData();api.stageData(journal());
    vi.resetModules();api = await import('../src/api');await api.getAppData();
    await expect(api.saveRemoteData(journal())).rejects.toThrow('заблокирована');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(loadPending()).not.toBeNull();
  });
});

describe('shared local storage guard', () => {
  it('refuses to overwrite another tab’s pending changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response()));
    const tabA = await import('../src/api');await tabA.getAppData();
    vi.resetModules();const tabB = await import('../src/api');await tabB.getAppData();
    const changes = journal();changes.workouts[0].name = 'tab A';tabA.stageData(changes);
    expect(() => tabB.stageData(journal())).toThrow('другой вкладке');
    expect(loadPending()?.data).toEqual(changes);
  });
});

describe('authorized server reset recovery', () => {
  it('returns the authorized account to onboarding and archives its pending local journal', async () => {
    telegram(317226495);
    const { blankData, stagePending } = await import('../src/storage');
    const old = journal(); stagePending(old, '"old"'); saveData(old);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response(blankData(), '"new"', 317226495)));
    const api = await import('../src/api');
    expect(await api.getAppData()).toEqual(blankData());
    expect(api.getSyncState()).toBe('synced');
    expect(loadPending()).toBeNull();
    const backupKey = Object.keys(localStorage).find(k => k.includes(':before-server-reset:'))!;
    expect(JSON.parse(JSON.parse(localStorage.getItem(backupKey)!).pending).data).toEqual(old);
    expect(localStorage.getItem(`${userStorageKey()}:reset-2026-10-07`)).toBe('done');
  });
  it('preserves other accounts even if their server journal is absent', async () => {
    const { blankData, stagePending } = await import('../src/storage');
    const old = journal();stagePending(old, '"old"');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(blankData(), '"new"')));
    const api = await import('../src/api');
    expect(await api.getAppData()).toEqual(old);
    expect(api.getSyncState()).toBe('conflict');
    expect(loadPending()?.data).toEqual(old);
  });
  it('refuses recovery when the server still has a journal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response()));
    const api = await import('../src/api');await api.getAppData();api.stageData(journal());
    const before=localStorage.getItem(`${userStorageKey()}:pending`);
    await expect(api.recoverServerReset()).rejects.toThrow('На сервере есть журнал');
    expect(localStorage.getItem(`${userStorageKey()}:pending`)).toBe(before);
  });
});
