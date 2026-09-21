import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
};

type TelegramUser = { id: number; first_name?: string; last_name?: string; username?: string };

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
  { workoutTypeId: "legs", name: "Маятниковый присед", loadType: "weight", sortOrder: 1 },
  { workoutTypeId: "legs", name: "Жим ногами лёжа", loadType: "weight", sortOrder: 2 },
  { workoutTypeId: "legs", name: "Разгибание ног", loadType: "weight", sortOrder: 3 },
  { workoutTypeId: "legs", name: "Сгибание ног сидя", loadType: "weight", sortOrder: 4 },
  { workoutTypeId: "legs", name: "Сведение ног", loadType: "weight", sortOrder: 5 },
  { workoutTypeId: "legs", name: "Икры", loadType: "weight", sortOrder: 6 },
  { workoutTypeId: "legs", name: "Присед на одной ноге", loadType: "weight", sortOrder: 7 },
  { workoutTypeId: "legs", name: "Отведение ноги назад", loadType: "weight", sortOrder: 8 },
  { workoutTypeId: "arms", name: "Жим грифа (разминка)", loadType: "weight", sortOrder: 1 },
  { workoutTypeId: "arms", name: "Жим от груди (тренажер)", loadType: "weight", sortOrder: 2 },
  { workoutTypeId: "arms", name: "Разведение лёжа (грудь)", loadType: "weight", sortOrder: 3 },
  { workoutTypeId: "arms", name: "Жим гантелей сидя", loadType: "dumbbell", sortOrder: 4 },
  { workoutTypeId: "arms", name: "Разведение по диагонали", loadType: "weight", sortOrder: 5 },
  { workoutTypeId: "arms", name: "Трицепс на блоке", loadType: "weight", sortOrder: 6 },
  { workoutTypeId: "arms", name: "Сведение рук (Pec fly)", loadType: "weight", sortOrder: 7 },
  { workoutTypeId: "arms", name: "Пресс (доп.)", loadType: "weight", sortOrder: 8 },
  { workoutTypeId: "back_shoulders", name: "Подтягивания", loadType: "assisted", sortOrder: 1 },
  { workoutTypeId: "back_shoulders", name: "Разведение в стороны (плечи)", loadType: "weight", sortOrder: 2 },
  { workoutTypeId: "back_shoulders", name: "Тяга нижнего блока", loadType: "weight", sortOrder: 3 },
  { workoutTypeId: "back_shoulders", name: "Тяга верхнего блока", loadType: "weight", sortOrder: 4 },
  { workoutTypeId: "back_shoulders", name: "Тяга сидя", loadType: "weight", sortOrder: 5 },
  { workoutTypeId: "back_shoulders", name: "Задняя дельта", loadType: "weight", sortOrder: 6 },
  { workoutTypeId: "back_shoulders", name: "Гиперэкстензия", loadType: "weight", sortOrder: 7 },
  { workoutTypeId: "back_shoulders", name: "Пресс (доп.)", loadType: "weight", sortOrder: 8 },
];

function buildDefaultData(): AppData {
  return {
    workoutTypes: structuredClone(defaultWorkoutTypes),
    exercises: defaultExercises.map((x) => ({
      id: crypto.randomUUID(),
      workoutTypeId: x.workoutTypeId,
      name: x.name,
      loadType: x.loadType,
      sortOrder: x.sortOrder,
      isActive: true,
    })),
    workouts: [],
  };
}


async function hmacSha256(key: Uint8Array | string, message: string | Uint8Array) {
  const keyData = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const messageData = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, messageData));
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
  const maxAge = 24 * 60 * 60;
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > maxAge) {
    throw new Error('Telegram initData is expired');
  }

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  // Telegram Web Apps: secret_key = HMAC-SHA-256("WebAppData", bot_token).
  const secretKey = await hmacSha256('WebAppData', botToken);
  const calculated = await hmacSha256(secretKey, dataCheckString);
  const received = Uint8Array.from(receivedHash.match(/.{1,2}/g)?.map((h) => parseInt(h, 16)) ?? []);
  if (!constantTimeEqual(calculated, received)) throw new Error('Telegram initData signature is invalid');

  const userRaw = params.get('user');
  if (!userRaw) throw new Error('Telegram user is missing');
  const user = JSON.parse(userRaw) as TelegramUser;
  if (!user?.id) throw new Error('Telegram user id is missing');
  return user;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function telegramInitData(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  return auth.startsWith('tma ') ? auth.slice(4) : '';
}

function normalizeAppData(raw: unknown): AppData | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<AppData>;
  if (!Array.isArray(value.workoutTypes) || !Array.isArray(value.exercises) || !Array.isArray(value.workouts)) return null;
  return value as AppData;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await validateTelegramInitData(telegramInitData(req));
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase server configuration is incomplete');

    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const { error: userUpsertError } = await db.from('users').upsert({
      telegram_id: user.id,
      username: user.username ?? null,
      first_name: user.first_name ?? null,
    }, { onConflict: 'telegram_id' });
    if (userUpsertError) throw userUpsertError;

    if (req.method === 'GET') {
      const { data: row, error } = await db
        .from('user_app_data')
        .select('data')
        .eq('telegram_user_id', user.id)
        .maybeSingle();
      if (error) throw error;

      if (row?.data) return json(row.data);

      const initial = buildDefaultData();
      const { error: insertError } = await db.from('user_app_data').insert({
        telegram_user_id: user.id,
        data: initial,
      });
      if (insertError && insertError.code !== '23505') throw insertError;
      return json(initial);
    }

    if (req.method === 'PUT') {
      const body = normalizeAppData(await req.json());
      if (!body) return json({ error: 'Invalid AppData payload' }, 400);

      const { data, error } = await db.from('user_app_data').upsert({
        telegram_user_id: user.id,
        data: body,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'telegram_user_id' }).select('data').single();
      if (error) throw error;
      return json(data.data);
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 401);
  }
});
