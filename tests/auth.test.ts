import { describe, expect, it } from 'vitest';
import { validateTelegramInitData } from '../supabase/functions/api/auth';

import { signedInitData, testBotToken } from './telegram-fixture';

describe('Telegram authentication', () => {
  it('validates independently signed initData', async () => {
    expect((await validateTelegramInitData(signedInitData(), testBotToken)).id).toBe(101);
  });
  it('rejects identity substitution', async () => {
    const params = new URLSearchParams(signedInitData());
    params.set('user', JSON.stringify({ id: 202 }));
    await expect(validateTelegramInitData(params.toString(), testBotToken)).rejects.toThrow('signature');
  });
  it.each(['', 'hash=xyz', signedInitData(101, 1), signedInitData(101, Math.floor(Date.now()/1000)+120)])('rejects missing, malformed, expired and future credentials', async value => {
    await expect(validateTelegramInitData(value, testBotToken)).rejects.toThrow();
  });
  it('rejects a signature issued for another bot and invalid signed user IDs', async () => {
    await expect(validateTelegramInitData(signedInitData(), 'other-bot')).rejects.toThrow();
    await expect(validateTelegramInitData(signedInitData(-1), testBotToken)).rejects.toThrow('id');
  });
});
