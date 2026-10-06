import { useState } from 'react';
import { readAppearance, saveAppearance, type Appearance } from './appearance';

export function DesignPreferences() {
  const [appearance, setAppearance] = useState(readAppearance);
  const [error, setError] = useState('');
  function choose(next: Appearance) {
    try { saveAppearance(next); setAppearance(next); setError(''); }
    catch { setError('Не удалось сохранить оформление на устройстве.'); }
  }
  return <section className="card design-preferences" aria-labelledby="design-title">
    <h2 id="design-title">Дизайн приложения</h2>
    <p className="muted">Можно вернуться к прежнему виду в любой момент. Тренировки останутся на месте.</p>
    <div className="segmented design-choice" role="group" aria-label="Дизайн приложения">
      <button type="button" aria-pressed={appearance.design === 'apple'} className={appearance.design === 'apple' ? 'active' : ''} onClick={() => choose({ ...appearance, design: 'apple' })}>Новый</button>
      <button type="button" aria-pressed={appearance.design === 'classic'} className={appearance.design === 'classic' ? 'active' : ''} onClick={() => choose({ ...appearance, design: 'classic' })}>Классический</button>
    </div>
    {appearance.design === 'apple' && <div className="design-tone-row"><span>Тема нового дизайна</span><div className="segmented compact" role="group" aria-label="Тема нового дизайна">
      <button type="button" aria-pressed={appearance.tone === 'light'} className={appearance.tone === 'light' ? 'active' : ''} onClick={() => choose({ ...appearance, tone: 'light' })}>Светлая</button>
      <button type="button" aria-pressed={appearance.tone === 'dark'} className={appearance.tone === 'dark' ? 'active' : ''} onClick={() => choose({ ...appearance, tone: 'dark' })}>Тёмная</button>
    </div></div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
