import type { AppData } from '../_shared/types.ts';
import { blankData } from '../_shared/defaults.ts';
import { isValidAppData } from '../_shared/domain.ts';
import type { TelegramUser } from './auth.ts';

export interface Row { data: AppData; updated_at: string }
export interface Repository {
  read(userId: number): Promise<Row | null>;
  insert(userId: number, data: AppData): Promise<Row | null>;
  compareAndSwap(userId: number, expected: string, data: AppData): Promise<Row | null>;
  saveIdentity(user: TelegramUser): Promise<void>;
}
export interface Dependencies {
  authenticate(initData: string): Promise<TelegramUser>;
  repository(): Repository;
  notify(userId: number): Promise<void>;
  reportError(error: unknown): void;
}
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, if-match',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'ETag, X-Telegram-User-Id',
  'Cache-Control': 'no-store',
};
const etag = (row: Row | null) => JSON.stringify(row?.updated_at ?? 'new');
function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
async function readBody(req: Request): Promise<unknown> {
  // Bound memory use even when Content-Length is absent or forged.
  const reader = req.body?.getReader();
  if (!reader) throw new Error('Invalid JSON');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 5 * 1024 * 1024) { await reader.cancel(); throw new Error('Payload too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    let user: TelegramUser;
    try {
      const auth = req.headers.get('authorization') ?? '';
      user = await deps.authenticate(auth.startsWith('tma ') ? auth.slice(4).trim() : '');
    } catch { return json({ error: 'Telegram authentication failed' }, 401); }
    try {
      const identity = { 'X-Telegram-User-Id': String(user.id) };
      if (!['GET', 'PUT', 'POST'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);
      if (req.method === 'POST') {
        let body: unknown;
        try { body = await readBody(req); } catch { return json({ error: 'Invalid request body' }, 400); }
        const action = body && typeof body === 'object' && 'action' in body ? body.action : undefined;
        // Legacy callers may still send this action. Never let user auth alter bot configuration.
        if (action === 'ensure_menu_button') return json({ error: 'Bot configuration is not a user operation' }, 403);
        // Deletes are now versioned PUTs in the same queue as all other mutations.
        if (action === 'delete_workout') return json({ error: 'Use a versioned PUT to delete a workout' }, 428);
        if (action !== 'timer_expired') return json({ error: 'Unknown action' }, 400);
        await deps.notify(user.id);
        return json({ ok: true });
      }
      const db = deps.repository();
      if (req.method === 'GET') {
        const row = await db.read(user.id);
        if (row && !isValidAppData(row.data)) return json({ error: 'Stored journal requires recovery; no data was changed' }, 500);
        // Reading never creates users, resets journals or performs legacy backfills.
        // Any persisted journal is treated conservatively as an existing user.
        const data = row ? { ...row.data, onboardingComplete: true } : blankData();
        return json(data, 200, { ...identity, ETag: etag(row) });
      }
      const expected = req.headers.get('if-match');
      if (!expected) return json({ error: 'A journal version is required. Update the app before saving.' }, 428);
      let body: unknown;
      try { body = await readBody(req); } catch (error) {
        return json({ error: 'Invalid request body' }, error instanceof Error && error.message === 'Payload too large' ? 413 : 400);
      }
      if (!isValidAppData(body)) return json({ error: 'Invalid AppData payload' }, 400);
      const current = await db.read(user.id);
      if (expected !== etag(current)) return json({ error: 'Journal version conflict; no data was changed' }, 409);
      await db.saveIdentity(user);
      const row = current
        ? await db.compareAndSwap(user.id, current.updated_at, body)
        : await db.insert(user.id, body);
      if (!row) return json({ error: 'Journal version conflict; no data was changed' }, 409);
      return json(row.data, 200, { ...identity, ETag: etag(row) });
    } catch (error) {
      deps.reportError(error);
      return json({ error: 'Operation failed; keep your local backup and retry later' }, 500);
    }
  };
}
