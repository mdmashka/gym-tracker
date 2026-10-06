import { expect, test } from '@playwright/test';
import { journal } from './fixtures';

test.beforeEach(async ({ context }) => {
  // Never let a browser regression touch production, including Telegram SDK/network calls.
  await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:4173/') ? route.continue() : route.abort());
});

test('mobile onboarding → save with timer open → reload → calendar → identical history', async ({ page }) => {
  const errors: string[] = [];page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Настроим тренировки' })).toBeVisible();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  const tour = page.getByRole('dialog');
  for (let i = 0; i < 4; i++) await tour.getByRole('button', { name: 'Далее', exact: true }).click();
  await tour.getByRole('button', { name: 'Начать', exact: true }).click();
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click();
  await page.locator('.start-option').filter({ hasText: 'Fullbody' }).click();
  await page.getByPlaceholder('Вес', { exact: true }).fill('19,1');
  await page.getByPlaceholder('Повторы', { exact: true }).fill('12');
  await page.getByPlaceholder('Комментарий к следующему подходу (необязательно)').fill('Сохранить комментарий');
  await page.getByRole('button', { name: '+ Подход', exact: true }).click();
  await expect(page.locator('.timer-fab')).toBeVisible();
  // A real click detects timer/finish overlap; do not force or bypass hit testing.
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Тренировка завершена', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gym-log:data:v2:browser-demo')!));
  expect(saved.workouts[0].exercises[0].sets[0]).toMatchObject({ weight: 19.1, reps: 12, comment: 'Сохранить комментарий' });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Настроим тренировки' })).toHaveCount(0);
  await page.locator('.activity-day').filter({ hasText: new RegExp(`^${Number(saved.workouts[0].date.slice(-2))}$`) }).click();
  await page.locator('.date-workout-modal .start-option').click();
  await expect(page.getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible();
  await expect(page.locator('.summary-result').first()).toHaveText(/^19\.1 кг × 12\s*Сохранить комментарий$/);
  await expect(page.getByText('Сохранить комментарий', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gym-log:data:v2:browser-demo')!).workouts)).toEqual(saved.workouts);
  expect(errors).toEqual([]);
});

test('legacy user reload preserves journal without any demo onboarding flag', async ({ page }) => {
  const data = { ...journal(), onboardingComplete: undefined };
  await page.addInitScript(value => {
    if (!localStorage.getItem('gym-log:data:v2:browser-demo')) localStorage.setItem('gym-log:data:v2:browser-demo', JSON.stringify(value));
  }, data);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Настроим тренировки' })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gym-log:data:v2:browser-demo')!))).toEqual(JSON.parse(JSON.stringify(data)));
});

test('mobile template editor distinguishes delete and recovers after deleting the last template', async ({ page }) => {
  const data = journal();data.workoutTypes = data.workoutTypes.filter(t => t.id === 'legs');
  await page.addInitScript(value => localStorage.setItem('gym-log:data:v2:browser-demo', JSON.stringify(value)), data);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.getByRole('button', { name: /Настройки/ }).click();
  const deletion = page.getByRole('button', { name: 'Удалить шаблон', exact: true });
  expect(await deletion.evaluate(el => getComputedStyle(el).color)).toBe('rgb(255, 59, 48)');
  await deletion.click();
  await expect(page.getByText(/Нет доступных шаблонов/)).toBeVisible();
  await page.getByPlaceholder('Например, Верх тела').fill('Новый шаблон');
  await page.getByRole('button', { name: 'Добавить шаблон', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Новый шаблон', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gym-log:data:v2:browser-demo')!));
  expect(saved.workouts[0].exercises).toEqual(data.workouts[0].exercises);
  expect(saved.workoutTypes[0].name).toBe('Новый шаблон');
});
