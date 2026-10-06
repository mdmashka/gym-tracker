export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};


async function hmacSha256(key: Uint8Array | string, message: string | Uint8Array) {
  const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : new Uint8Array(key);
  const messageBytes = typeof message === 'string' ? new TextEncoder().encode(message) : new Uint8Array(message);
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

export async function validateTelegramInitData(initData: string, botToken: string): Promise<TelegramUser> {
  if (!initData) throw new Error('Telegram initData is missing');

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

  if (!Number.isSafeInteger(user?.id) || user.id <= 0) throw new Error('Telegram user id is invalid');
  return user;
}

