export interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: { id: number; first_name?: string; last_name?: string; username?: string } };
  themeParams?: Record<string, string>;
  isExpanded?: boolean;
  ready(): void;
  expand(): void;
  close(): void;
  showPopup?(params: { title?: string; message: string; buttons?: { id?: string; type?: string; text: string }[] }, callback?: (buttonId: string) => void): void;
  HapticFeedback?: { impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void; notificationOccurred(type: 'error' | 'success' | 'warning'): void; selectionChanged(): void };
  BackButton: { isVisible: boolean; show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  MainButton?: {
    text: string;
    isVisible: boolean;
    isActive: boolean;
    show(): void;
    hide(): void;
    enable(): void;
    disable(): void;
    setText(text: string): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
}

declare global {
  interface Window { Telegram?: { WebApp: TelegramWebApp } }
}

export function getTelegram(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function initTelegram() {
  const tg = getTelegram();
  if (!tg) return;
  tg.ready();
  tg.expand();
  const root = document.documentElement;
  const params = tg.themeParams ?? {};
  for (const [key, value] of Object.entries(params)) {
    root.style.setProperty(`--tg-${camelToKebab(key)}`, value);
  }
  root.style.setProperty('--tg-bg-color', params.bg_color ?? '#f2f2f7');
  root.style.setProperty('--tg-text-color', params.text_color ?? '#111111');
  root.style.setProperty('--tg-secondary-bg-color', params.secondary_bg_color ?? '#ffffff');
  root.style.setProperty('--tg-hint-color', params.hint_color ?? '#8e8e93');
  root.style.setProperty('--tg-link-color', params.link_color ?? '#2481cc');
  root.style.setProperty('--tg-button-color', params.button_color ?? '#2481cc');
  root.style.setProperty('--tg-button-text-color', params.button_text_color ?? '#ffffff');
}

function camelToKebab(k: string) {
  return k.replace(/_/g, '-').toLowerCase();
}

export function haptic(type: 'light' | 'medium' | 'success' | 'error' = 'light') {
  const tg = getTelegram();
  try {
    if (type === 'success' || type === 'error') tg?.HapticFeedback?.notificationOccurred(type);
    else tg?.HapticFeedback?.impactOccurred(type);
  } catch { /* browser/demo mode */ }
}
