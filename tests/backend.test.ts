import { describe, expect, it, vi } from 'vitest';
import type { AppData } from '../src/types';
import { createHandler, type Repository, type Row } from '../supabase/functions/api/handler';
import { validateTelegramInitData } from '../supabase/functions/api/auth';
import { journal } from './fixtures';
import { signedInitData, testBotToken } from './telegram-fixture';

function server() {
  const rows = new Map<number, Row>();
  let revision = 0;
  const write = (id: number, data: AppData) => {
    const row = { data: structuredClone(data), updated_at: new Date(1700000000000 + ++revision).toISOString() };
    rows.set(id, row); return row;
  };
  const repository: Repository = {
    read: vi.fn(async id => structuredClone(rows.get(id) ?? null)),
    insert: vi.fn(async (id, data) => rows.has(id) ? null : write(id, data)),
    compareAndSwap: vi.fn(async (id, expected, data) => rows.get(id)?.updated_at === expected ? write(id, data) : null),
    saveIdentity: vi.fn(async () => {}),
  };
  const notify = vi.fn(async () => {});
  const handler = createHandler({ authenticate: value => validateTelegramInitData(value, testBotToken), repository: () => repository, notify, reportError: vi.fn() });
  const request = (id: number, method = 'GET', data?: unknown, version?: string) => handler(new Request('https://test.invalid/api', {
    method, headers: { Authorization: `tma ${signedInitData(id)}`, ...(version ? { 'If-Match': version } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  }));
  return { rows, repository, request, notify, handler, write };
}

describe('versioned journal API', () => {
  it('GET is read-only for both new and legacy users', async () => {
    const s = server();
    const legacy = { ...journal(), onboardingComplete: undefined };
    s.write(101, legacy);
    const old = await s.request(101);
    expect((await old.json()).onboardingComplete).toBe(true);
    expect(s.rows.get(101)?.data.onboardingComplete).toBeUndefined();
    const fresh = await s.request(202);
    expect(fresh.headers.get('ETag')).toBe('"new"');
    expect((await fresh.json()).onboardingComplete).toBe(false);
    expect(s.rows.has(202)).toBe(false);
    expect(s.repository.saveIdentity).not.toHaveBeenCalled();
    expect(s.repository.insert).not.toHaveBeenCalled();
    expect(s.repository.compareAndSwap).not.toHaveBeenCalled();
  });
  it('rejects unversioned old clients before any journal/identity write', async () => {
    const s = server();s.write(101, journal());
    const original = structuredClone(s.rows.get(101));
    expect((await s.request(101, 'PUT', journal())).status).toBe(428);
    expect(s.rows.get(101)).toEqual(original);
    expect(s.repository.saveIdentity).not.toHaveBeenCalled();
  });
  it('allows exactly one concurrent writer and preserves its full journal', async () => {
    const s = server();s.write(101, journal());
    const version = (await s.request(101)).headers.get('ETag')!;
    const a = journal();a.workouts[0].name = 'A';
    const b = journal();b.workouts[0].name = 'B';
    const responses = await Promise.all([s.request(101, 'PUT', a, version), s.request(101, 'PUT', b, version)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const accepted = responses.find(r => r.status === 200)!;
    expect(s.rows.get(101)?.data).toEqual(await accepted.json());
    expect(accepted.headers.get('ETag')).not.toBe(version);
  });
  it('does not replace a first user created concurrently', async () => {
    const s = server();
    const initial = journal();
    const responses = await Promise.all([s.request(101, 'PUT', initial, '"new"'), s.request(101, 'PUT', initial, '"new"')]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  });
  it('isolates A/B reads, updates and deletes regardless of body owner fields', async () => {
    const s = server();
    const a = journal();a.workouts[0].name = 'User A';
    const b = journal();b.workouts[0].name = 'User B';
    s.write(101, a);s.write(202, b);
    const beforeB = structuredClone(s.rows.get(202));
    const response = await s.request(101);
    expect((await response.clone().json()).workouts[0].name).toBe('User A');
    const deletion = { ...a, workouts: [], telegram_user_id: 202 };
    expect((await s.request(101, 'PUT', deletion, response.headers.get('ETag')!)).status).toBe(200);
    expect(s.rows.get(101)?.data.workouts).toEqual([]);
    expect(s.rows.get(202)).toEqual(beforeB);
    expect((await s.request(101, 'POST', { action: 'delete_workout', workoutId: b.workouts[0].id })).status).toBe(428);
    expect(s.rows.get(202)).toEqual(beforeB);
  });
  it('rejects a forged identity before touching storage', async () => {
    const s = server();
    const params = new URLSearchParams(signedInitData(101));params.set('user', JSON.stringify({ id: 202 }));
    const response = await s.handler(new Request('https://test.invalid/api', { headers: { Authorization: `tma ${params}` } }));
    expect(response.status).toBe(401);
    expect(s.repository.read).not.toHaveBeenCalled();
  });
  it('does not permit user auth to change any bot menu', async () => {
    const s = server();
    expect((await s.request(101, 'POST', { action: 'ensure_menu_button', url: 'https://attacker.invalid' })).status).toBe(403);
    expect(s.notify).not.toHaveBeenCalled();
    expect(s.repository.saveIdentity).not.toHaveBeenCalled();
  });
  it('rejects malformed journal data without replacing stored records', async () => {
    const s = server();s.write(101, journal());
    const original = structuredClone(s.rows.get(101));
    const version = (await s.request(101)).headers.get('ETag')!;
    expect((await s.request(101, 'PUT', { workoutTypes: [], exercises: [], workouts: [{}] }, version)).status).toBe(400);
    expect(s.rows.get(101)).toEqual(original);
  });
  it('does not resurrect a deleted workout from an older snapshot', async () => {
    const s = server();const data = journal();s.write(101, data);
    const oldVersion = (await s.request(101)).headers.get('ETag')!;
    expect((await s.request(101, 'PUT', { ...data, workouts: [] }, oldVersion)).status).toBe(200);
    expect((await s.request(101, 'PUT', data, oldVersion)).status).toBe(409);
    expect(s.rows.get(101)?.data.workouts).toEqual([]);
  });
  it('preserves empty completed workouts on unrelated updates', async () => {
    const s = server();const data = journal();data.workouts[0].exercises.forEach(e => e.sets = []);s.write(101, data);
    const version = (await s.request(101)).headers.get('ETag')!;
    expect((await s.request(101, 'PUT', data, version)).status).toBe(200);
    expect(s.rows.get(101)?.data.workouts).toEqual(data.workouts);
  });
});

it('never replays onboarding for a persisted zero-workout journal with an old false flag', async () => {
  const s = server();const data = journal();data.workouts=[];data.onboardingComplete=false;s.write(101,data);
  const result = await (await s.request(101)).json();
  expect(result.onboardingComplete).toBe(true);
  expect(result.workoutTypes).toEqual(data.workoutTypes);
  expect(s.rows.get(101)?.data.onboardingComplete).toBe(false);
  expect(s.repository.compareAndSwap).not.toHaveBeenCalled();
});
