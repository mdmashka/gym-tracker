import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
};

type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type AppData = {
  workoutTypes: Array<{ id: string; name: string; slug: string }>;
  exercises: Array<{
    id: string;
    workoutTypeId: string;
    name: string;
    loadType: string;
    sortOrder: number;
    isActive: boolean;
  }>;
  workouts: unknown[];
};

const defaultWorkoutTypes = [
  { id: 'legs', name: 'Ноги', slug: 'legs' },
  { id: 'arms', name: 'Руки', slug: 'arms' },
  { id: 'back_shoulders', name: 'Спина + плечи', slug: 'back_shoulders' },
];

const defaultExercises = [
  { workoutTypeId: 'legs', name: 'Маятниковый присед', loadType: 'weight', sortOrder: 1 },
  { workoutTypeId: 'legs', name: 'Жим ногами лёжа', loadType: 'weight', sortOrder: 2 },
  { workoutTypeId: 'legs', name: 'Разгибание ног', loadType: 'weight', sortOrder: 3 },
  { workoutTypeId: 'legs', name: 'Сгибание ног сидя', loadType: 'weight', sortOrder: 4 },
  { workoutTypeId: 'legs', name: 'Сведение ног', loadType: 'weight', sortOrder: 5 },
  { workoutTypeId: 'legs', name: 'Икры', loadType: 'weight', sortOrder: 6 },
  { workoutTypeId: 'legs', name: 'Присед на одной ноге', loadType: 'weight', sortOrder: 7 },
  { workoutTypeId: 'legs', name: 'Отведение ноги назад', loadType: 'weight', sortOrder: 8 },
  { workoutTypeId: 'arms', name: 'Жим грифа (разминка)', loadType: 'weight', sortOrder: 1 },
  { workoutTypeId: 'arms', name: 'Жим от груди (тренажер)', loadType: 'weight', sortOrder: 2 },
  { workoutTypeId: 'arms', name: 'Разведение лёжа (грудь)', loadType: 'weight', sortOrder: 3 },
  { workoutTypeId: 'arms', name: 'Жим гантелей сидя', loadType: 'weight', sortOrder: 4 },
  { workoutTypeId: 'arms', name: 'Разведение по диагонали', loadType: 'weight', sortOrder: 5 },
  { workoutTypeId: 'arms', name: 'Трицепс на блоке', loadType: 'weight', sortOrder: 6 },
  { workoutTypeId: 'arms', name: 'Сведение рук (Pec fly)', loadType: 'weight', sortOrder: 7 },
  { workoutTypeId: 'arms', name: 'Пресс (доп.)', loadType: 'weight', sortOrder: 8 },
  { workoutTypeId: 'back_shoulders', name: 'Подтягивания', loadType: 'assisted', sortOrder: 1 },
  { workoutTypeId: 'back_shoulders', name: 'Разведение в стороны (плечи)', loadType: 'weight', sortOrder: 2 },
  { workoutTypeId: 'back_shoulders', name: 'Тяга нижнего блока', loadType: 'weight', sortOrder: 3 },
  { workoutTypeId: 'back_shoulders', name: 'Тяга верхнего блока', loadType: 'weight', sortOrder: 4 },
  { workoutTypeId: 'back_shoulders', name: 'Тяга сидя', loadType: 'weight', sortOrder: 5 },
  { workoutTypeId: 'back_shoulders', name: 'Задняя дельта', loadType: 'weight', sortOrder: 6 },
  { workoutTypeId: 'back_shoulders', name: 'Гиперэкстензия', loadType: 'weight', sortOrder: 7 },
  { workoutTypeId: 'back_shoulders', name: 'Пресс (доп.)', loadType: 'weight', sortOrder: 8 },
];

function buildDefaultData(): AppData {
  return {
    workoutTypes: structuredClone(defaultWorkoutTypes),
    exercises: defaultExercises.map((exercise) => ({
      id: crypto.randomUUID(),
      workoutTypeId: exercise.workoutTypeId,
      name: exercise.name,
      loadType: exercise.loadType,
      sortOrder: exercise.sortOrder,
      isActive: true,
    })),
    workouts: [],
  };
}

async function hmacSha256(key: Uint8Array | string, message: string | Uint8Array) {
  const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const messageBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, messageBytes));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function validateTelegramInitData(initData: string): Promise<TelegramUser> {
  if (!initData) throw new Error('Telegram initData is missing');

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not configured');

  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash) throw new Error('Telegram hash is missing');
  params.delete('hash');

  const authDate = Number(params.get('auth_date') ?? '0');
  const now = Math.floor(Date.now() / 1000);
  const maxAgeSeconds = 24 * 60 * 60;
  if (!authDate || authDate > now + 60 || now - authDate > maxAgeSeconds) {
    throw new Error('Telegram initData is expired or invalid');
  }

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = await hmacSha256('WebAppData', botToken);
  const calculatedHash = await hmacSha256(secretKey, dataCheckString);

  const normalizedHash = receivedHash.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalizedHash)) {
    throw new Error('Telegram hash format is invalid');
  }
  const received = new Uint8Array(
    normalizedHash.match(/.{2}/g)!.map((pair) => parseInt(pair, 16)),
  );

  if (!constantTimeEqual(calculatedHash, received)) {
    throw new Error('Telegram initData signature is invalid');
  }

  const userRaw = params.get('user');
  if (!userRaw) throw new Error('Telegram user is missing');

  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw) as TelegramUser;
  } catch {
    throw new Error('Telegram user payload is invalid');
  }

  if (!user?.id) throw new Error('Telegram user id is missing');
  return user;
}

function getTelegramInitData(req: Request) {
  const authorization = req.headers.get('authorization') ?? '';
  if (authorization.startsWith('tma ')) return authorization.slice(4).trim();

  const customHeader = req.headers.get('x-telegram-init-data');
  return customHeader?.trim() ?? '';
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function getSupabaseServerKey() {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;

  const secretKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeysRaw) {
    try {
      const secretKeys = JSON.parse(secretKeysRaw) as Record<string, string>;
      if (secretKeys.default) return secretKeys.default;
    } catch {
      // Fall through to the explicit error below.
    }
  }

  throw new Error('Supabase server secret key is not configured');
}

function isValidAppData(value: unknown): value is AppData {
  if (!value || typeof value !== 'object') return false;
  const app = value as Partial<AppData>;
  return Array.isArray(app.workoutTypes)
    && Array.isArray(app.exercises)
    && Array.isArray(app.workouts);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const telegramUser = await validateTelegramInitData(getTelegramInitData(req));

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!supabaseUrl) throw new Error('SUPABASE_URL is not configured');

    const db = createClient(supabaseUrl, getSupabaseServerKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Keep Telegram identity in the users table.
    const { error: userError } = await db.from('users').upsert(
      {
        telegram_id: telegramUser.id,
        username: telegramUser.username ?? null,
        first_name: telegramUser.first_name ?? null,
      },
      { onConflict: 'telegram_id' },
    );
    if (userError) throw userError;

    if (req.method === 'POST') {
      let body: { action?: string };
      try { body = await req.json() as { action?: string }; } catch { return json({ error: 'Invalid JSON body' }, 400); }
      const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
      if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not configured');

      if (body.action === 'timer_expired') {
        const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: telegramUser.id, text: '⏱️ Время отдыха вышло. Можно делать следующий подход.' }),
        });
        const telegramJson = await telegramRes.json();
        if (!telegramRes.ok || !telegramJson.ok) throw new Error(`Telegram sendMessage failed: ${telegramJson.description ?? telegramRes.status}`);
        return json({ ok: true });
      }

      if (body.action === 'ensure_menu_button') {
        const appUrl = typeof body.url === 'string' && body.url.startsWith('https://') ? body.url : (Deno.env.get('MINI_APP_URL') ?? 'https://gym-tracker-vercel-drop.vercel.app');
        const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/setChatMenuButton`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ menu_button: { type: 'web_app', text: 'Открыть приложение', web_app: { url: appUrl } } }),
        });
        const telegramJson = await telegramRes.json();
        if (!telegramRes.ok || !telegramJson.ok) throw new Error(`Telegram setChatMenuButton failed: ${telegramJson.description ?? telegramRes.status}`);
        return json({ ok: true });
      }

      return json({ error: 'Unknown action' }, 400);
    }

    if (req.method === 'GET') {
      const { data: row, error } = await db
        .from('user_app_data')
        .select('data')
        .eq('telegram_user_id', telegramUser.id)
        .maybeSingle();

      if (error) throw error;

      if (row?.data) return json(row.data);

      const initial = buildDefaultData();
      const { error: insertError } = await db.from('user_app_data').insert({
        telegram_user_id: telegramUser.id,
        data: initial,
      });

      if (insertError && insertError.code !== '23505') throw insertError;
      return json(initial);
    }

    if (req.method === 'PUT') {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: 'Invalid JSON body' }, 400);
      }

      if (!isValidAppData(body)) {
        return json({ error: 'Invalid AppData payload' }, 400);
      }

      const { data, error } = await db
        .from('user_app_data')
        .upsert(
          {
            telegram_user_id: telegramUser.id,
            data: body,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'telegram_user_id' },
        )
        .select('data')
        .single();

      if (error) throw error;
      return json(data.data);
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('Gym Tracker API error:', error);
    const message = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : (() => {
            try { return JSON.stringify(error); } catch { return 'Unexpected error'; }
          })();
    const authError = message.startsWith('Telegram ');
    return json({ error: message }, authError ? 401 : 500);
  }
});
