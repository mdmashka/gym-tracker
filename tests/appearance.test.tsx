import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DesignPreferences } from '../src/DesignPreferences';
import { APPEARANCE_KEY, applyAppearance, readAppearance } from '../src/appearance';
import { journal } from './fixtures';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); delete document.documentElement.dataset.uiDesign; delete document.documentElement.dataset.uiTone; });

it('switches to the previous design without changing journals, pending edits or their settings', async () => {
  const keys = ['gym-log:data:v2:101', 'gym-log:data:v2:101:pending', 'gym-log:data:v2:browser-demo'];
  const snapshot = JSON.stringify(journal());
  keys.forEach(key => localStorage.setItem(key, snapshot));
  applyAppearance(readAppearance());
  render(<DesignPreferences/>);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Тёмная' }));
  await user.click(screen.getByRole('button', { name: 'Классический' }));
  expect(document.documentElement.dataset.uiDesign).toBe('classic');
  expect(readAppearance()).toEqual({ design: 'classic', tone: 'dark' });
  keys.forEach(key => expect(localStorage.getItem(key)).toBe(snapshot));
  cleanup(); render(<DesignPreferences/>);
  expect(screen.getByRole('button', { name: 'Классический' }).getAttribute('aria-pressed')).toBe('true');
  await user.click(screen.getByRole('button', { name: 'Новый' }));
  expect(document.documentElement.dataset.uiDesign).toBe('apple');
  expect(document.documentElement.dataset.uiTone).toBe('dark');
  keys.forEach(key => expect(localStorage.getItem(key)).toBe(snapshot));
});

it('retains the selected design when browser storage cannot save a preference', async () => {
  applyAppearance(readAppearance());
  render(<DesignPreferences/>);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  await userEvent.click(screen.getByRole('button', { name: 'Классический' }));
  expect(document.documentElement.dataset.uiDesign).toBe('apple');
  expect(screen.getByRole('alert').textContent).toMatch(/Не удалось сохранить/);
});

it('falls back safely when appearance preferences are corrupt', () => {
  localStorage.setItem(APPEARANCE_KEY, '{bad');
  expect(readAppearance()).toEqual({ design: 'apple', tone: 'light' });
});
