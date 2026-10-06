// Presentation preferences are local to this browser, separate from all journal keys.
export const APPEARANCE_KEY = 'gym-tracker:appearance:v1';
export type Appearance = { design: 'apple' | 'classic'; tone: 'light' | 'dark' };
export function readAppearance(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? 'null');
    return { design: saved?.design === 'classic' ? 'classic' : 'apple', tone: saved?.tone === 'dark' ? 'dark' : 'light' };
  } catch { return { design: 'apple', tone: 'light' }; }
}
export function applyAppearance(value: Appearance) {
  document.documentElement.dataset.uiDesign = value.design;
  document.documentElement.dataset.uiTone = value.tone;
  const theme = value.design === 'apple' ? value.tone : document.documentElement.dataset.appTheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value.design === 'classic' ? (theme === 'dark' ? '#000000' : '#f2f2f7') : (theme === 'dark' ? '#161618' : '#f5f5f7'));
}
export function saveAppearance(value: Appearance) {
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify(value));
  applyAppearance(value);
}
