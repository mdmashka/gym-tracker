import { useEffect, useState } from 'react';
import { getTelegram } from './telegram';
import './styles.css';

const endpoint = import.meta.env.VITE_MOBILE_LINK_URL || 'https://jyywrpxetdfzjdqhebpj.supabase.co/functions/v1/mobile/confirm';
export function linkParameter(): string {
  const tg = getTelegram();
  const signed = new URLSearchParams(tg?.initData ?? '').get('start_param');
  return signed ?? new URLSearchParams(window.location.search).get('tgWebAppStartParam') ?? '';
}
export function LinkConfirmation({ onCancel }: { onCancel: () => void }) {
  const [busy, setBusy] = useState(false), [done, setDone] = useState(false), [error, setError] = useState('');
  const tg = getTelegram();
  const parameter = linkParameter();
  const valid = /^link_[a-f0-9]{32}$/.test(parameter) && Boolean(tg?.initData);
  useEffect(() => { tg?.ready(); tg?.expand(); }, [tg]);
  async function confirm() {
    if (!valid || busy || done) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `tma ${tg!.initData}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: parameter.slice(5) }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error(response.status === 409 ? 'Ссылка уже использована или истекла. Создай новую ссылку на телефоне.' : response.status === 401 ? 'Открой свежую ссылку из приложения в Telegram.' : 'Не удалось подтвердить подключение. Попробуй ещё раз.');
      const body = await response.json();
      if (body.linked !== true) throw Error('Подключение не подтверждено.');
      setDone(true);
    } catch (failure) { setError(String((failure as Error).message)); }
    finally { setBusy(false); }
  }
  return <div className="app theme-dark accent-red" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><section className="card" style={{ width: '100%', maxWidth: 440, padding: 24 }}>
    <div className="eyebrow">GYM TRACKER</div>
    <h1 style={{ fontSize: 28, marginTop: 12 }}>{done ? 'Telegram подключён' : 'Подключить телефон?'}</h1>
    {done ? <p className="muted">Вернись в приложение на телефоне и нажми «Я подтвердил(а) — проверить». Затем выбери тренировки для переноса.</p> : <><p>Этот телефон получит доступ к твоему журналу Gym Tracker в Telegram.</p><p className="muted">Подтверждай, только если ты только что нажал(а) «Подключить Telegram» на своём устройстве. Эта кнопка связывает аккаунты; тренировки выбираются отдельно и сейчас не переносятся.</p></>}
    {!valid ? <p role="alert">Ссылка недействительна. Открой новую ссылку из Gym Tracker в Telegram.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {!done ? <button className="primary" disabled={!valid || busy} onClick={() => void confirm()} style={{ width: '100%', marginTop: 12 }}>{busy ? 'Подключаем…' : 'Подтвердить подключение'}</button> : null}
    <button className="secondary" disabled={busy} onClick={done ? () => tg?.close() : onCancel} style={{ width: '100%', marginTop: 12 }}>{done ? 'Закрыть Telegram' : 'Не подключать — открыть журнал'}</button>
  </section></div>;
}
