import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { validateTelegramInitData } from './auth.ts';
import { createHandler, type Repository } from './handler.ts';

function serverKey() {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (key) return key;
  const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
  if (keys.default) return keys.default;
  throw new Error('Supabase server key is not configured');
}

Deno.serve(createHandler({
  authenticate: initData => validateTelegramInitData(initData, Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''),
  repository(): Repository {
    const url = Deno.env.get('SUPABASE_URL');
    if (!url) throw new Error('Supabase URL is not configured');
    const db = createClient(url, serverKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    return {
      async read(userId) {
        const { data, error } = await db.from('user_app_data').select('data,updated_at').eq('telegram_user_id', userId).maybeSingle();
        if (error) throw error;
        return data;
      },
      async saveIdentity(user) {
        // Keep the existing production identity table; schema reconciliation is a separate task.
        const { error } = await db.from('users').upsert({ telegram_id: user.id, username: user.username ?? null, first_name: user.first_name ?? null }, { onConflict: 'telegram_id' });
        if (error) throw error;
      },
      async insert(userId, journal) {
        const { data, error } = await db.from('user_app_data').insert({ telegram_user_id: userId, data: journal, updated_at: new Date().toISOString() }).select('data,updated_at').single();
        if (error?.code === '23505') return null;
        if (error) throw error;
        return data;
      },
      async compareAndSwap(userId, expected, journal) {
        // The predicate is checked by Postgres in the UPDATE, not just in application code.
        const updatedAt = new Date(Math.max(Date.now(), Date.parse(expected) + 1)).toISOString();
        const { data, error } = await db.from('user_app_data').update({ data: journal, updated_at: updatedAt }).eq('telegram_user_id', userId).eq('updated_at', expected).select('data,updated_at').maybeSingle();
        if (error) throw error;
        return data;
      },
    };
  },
  async notify(userId) {
    const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ chat_id: userId, text: '⏱️ Время отдыха вышло. Можно делать следующий подход.' }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error('Telegram notification failed');
  },
  reportError: error => console.error('Gym Tracker operation failed', error),
}));
