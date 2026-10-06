import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, CalendarScreen, RestTimer } from '../src/main';
import { loadData, loadPending, saveData } from '../src/storage';
import { journal } from './fixtures';

beforeEach(() => { localStorage.clear();delete window.Telegram; });
afterEach(() => { cleanup();vi.unstubAllGlobals();vi.useRealTimers();delete window.Telegram; });
const startApp = async () => { render(<App/>);await screen.findByRole('heading', { name: 'Сегодня' }); };
const openSettings = async (user: ReturnType<typeof userEvent.setup>) => { await user.click(screen.getByRole('button', { name: /Настройки/ }));await screen.findByRole('heading', { name: 'Настройки' }); };

describe('critical user journeys', () => {
  it('A/E/G: new user completes onboarding, saves a workout, reloads and opens identical sets from the calendar', async () => {
    const user = userEvent.setup();render(<App/>);
    await screen.findByRole('heading', { name: 'Настроим тренировки' });
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await user.click(screen.getByRole('button', { name: 'Начать' }));
    const tour = await screen.findByRole('dialog');
    for (let i = 0; i < 4; i++) await user.click(within(tour).getByRole('button', { name: 'Далее' }));
    await user.click(within(tour).getByRole('button', { name: 'Начать' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await user.click(screen.getByRole('button', { name: /Fullbody/ }));
    await user.type(screen.getByPlaceholderText('Вес'), '19,1');
    await user.type(screen.getByPlaceholderText('Повторы'), '12');
    await user.type(screen.getByPlaceholderText('Комментарий к следующему подходу (необязательно)'), 'Регрессия');
    await user.click(screen.getByRole('button', { name: '+ Подход' }));
    await user.click(screen.getByRole('button', { name: 'Завершить тренировку' }));
    await screen.findByRole('heading', { name: 'Тренировка завершена' });
    const saved = loadData();
    expect(saved.workouts[0].status).toBe('completed');
    expect(saved.workouts[0].exercises[0].sets[0]).toMatchObject({ weight: 19.1, reps: 12, comment: 'Регрессия' });
    cleanup();await startApp();
    expect(screen.queryByRole('heading', { name: 'Настроим тренировки' })).toBeNull();
    const day = Number(saved.workouts[0].date.slice(-2));
    await user.click(screen.getByRole('button', { name: String(day) }));
    await user.click(within(screen.getByRole('heading', { name: /октября/ }).closest('.modal')!).getByRole('button', { name: /Fullbody.*1 упражнений/ }));
    await screen.findByRole('button', { name: 'Редактировать' });
    expect(screen.getByText('19.1 кг × 12')).toBeTruthy();
    expect(screen.getByText('Регрессия')).toBeTruthy();
    expect(loadData().workouts).toEqual(saved.workouts);
  });
  it('B: update/reload keeps legacy workouts/templates without the demo reset key', async () => {
    const data = { ...journal(), onboardingComplete: undefined };saveData(data);
    await startApp();
    expect(screen.queryByRole('heading', { name: 'Настроим тренировки' })).toBeNull();
    expect(localStorage.getItem('gym-tracker-demo-onboarding-reset-v2')).toBeNull();
    expect(loadData()).toEqual(data);
  });
  it('C/D: create and edit a template, delete it and the last template, then recover from zero templates', async () => {
    const data = journal();data.workoutTypes = data.workoutTypes.filter(t => t.id === 'legs');saveData(data);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();await startApp();await openSettings(user);
    await user.type(screen.getByPlaceholderText('Например, Верх тела'), 'Мой шаблон');
    await user.click(screen.getByRole('button', { name: 'Добавить шаблон' }));
    await user.type(screen.getByPlaceholderText('Название упражнения'), 'Моё упражнение');
    await user.click(screen.getByRole('button', { name: 'Добавить в шаблон' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await screen.findByText('Сохранено');
    const created = loadData().workoutTypes.find(t => t.name === 'Мой шаблон')!;
    expect(loadData().exercises.some(e => e.workoutTypeId === created.id && e.name === 'Моё упражнение')).toBe(true);
    cleanup();await startApp();
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await user.click(screen.getByRole('button', { name: /Мой шаблон/ }));
    await user.type(screen.getByPlaceholderText('Вес'), '25');
    await user.type(screen.getByPlaceholderText('Повторы'), '10');
    await user.click(screen.getByRole('button', { name: '+ Подход' }));
    await user.click(screen.getByRole('button', { name: 'Завершить тренировку' }));
    await screen.findByRole('heading', { name: 'Тренировка завершена' });
    cleanup();await startApp();await openSettings(user);
    await user.click(screen.getByRole('button', { name: 'Мой шаблон' }));
    await user.click(screen.getByRole('button', { name: 'Удалить шаблон' }));
    await user.click(screen.getByRole('button', { name: 'Удалить шаблон' }));
    await screen.findByText(/Нет доступных шаблонов/);
    expect(loadData().workoutTypes).toEqual([]);
    expect(loadData().workouts[0].exercises).toEqual(data.workouts[0].exercises);
    await user.type(screen.getByPlaceholderText('Например, Верх тела'), 'Восстановленный');
    await user.click(screen.getByRole('button', { name: 'Добавить шаблон' }));
    await screen.findByRole('button', { name: 'Восстановленный' });
    expect(loadData().workoutTypes[0].name).toBe('Восстановленный');
  });
  it('renders custom exercise sets when reopening workout history', async () => {
    const data = journal();data.workouts[0].exercises[0].exerciseId = 'custom-only';data.workouts[0].exercises[0].customName = 'Разовое упражнение';saveData(data);
    const user = userEvent.setup();await startApp();
    await user.click(screen.getByRole('button', { name: /Сохранённая тренировка/ }));
    await screen.findByText('Разовое упражнение');
    expect(screen.getByText('19.1 кг × 12')).toBeTruthy();
  });
  it('does not show Saved or switch the template draft while a failed server save is pending', async () => {
    const data = journal();let settle!: (r: Response) => void;
    window.Telegram = { WebApp: { initData: 'test-init', initDataUnsafe: { user: { id: 101 } }, ready: vi.fn(), expand: vi.fn(), close: vi.fn(), BackButton: { isVisible: false, show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() } } } as NonNullable<Window['Telegram']>;
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(data), { headers: { ETag: '"v1"', 'X-Telegram-User-Id': '101' } })).mockImplementationOnce(() => new Promise<Response>(resolve => settle = resolve));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();await startApp();await openSettings(user);
    await user.type(screen.getByPlaceholderText('Название упражнения'), 'Черновик ног');
    await user.click(screen.getByRole('button', { name: 'Добавить в шаблон' }));
    await user.click(screen.getByRole('button', { name: 'Руки и грудь' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(loadPending()?.data.exercises.some(e => e.name === 'Черновик ног')).toBe(true);
    expect(screen.queryByText('Сохранено')).toBeNull();
    await act(async () => settle(new Response('{}', { status: 500 })));
    await screen.findByText('Есть несохранённые изменения');
    expect(screen.getByText('Черновик ног')).toBeTruthy();
    expect(screen.queryByText('Сохранено')).toBeNull();
    expect(loadPending()).not.toBeNull();
  });
});

describe('calendar and draft continuity', () => {
  it('opens either workout on the same date instead of silently choosing only one', async () => {
    const data = journal();data.workouts.push({ ...data.workouts[0], id: 'second-workout', name: 'Вторая тренировка' });
    const open = vi.fn();const user = userEvent.setup();
    render(<CalendarScreen data={data} onOpen={open} onCreate={vi.fn()}/>);
    await user.click(screen.getByRole('button', { name: data.workouts[0].date.slice(-2).replace(/^0/, '') }));
    await user.click(screen.getByRole('button', { name: 'Вторая тренировка' }));
    expect(open.mock.calls[0][0].id).toBe('second-workout');
  });
  it('resumes a draft without adding exercises from a subsequently edited template', async () => {
    const data = journal();data.workouts[0].status = 'draft';
    data.exercises.push({ ...data.exercises[0], id: 'later', name: 'Добавлено позже' });saveData(data);
    const user = userEvent.setup();await startApp();
    await user.click(screen.getByRole('button', { name: 'Продолжить тренировку' }));
    await screen.findByRole('button', { name: 'Завершить тренировку' });
    expect(loadData().workouts[0].exercises).toEqual(data.workouts[0].exercises);
    expect(screen.queryByText('Добавлено позже')).toBeNull();
  });
  it('starts a fresh rest timer when another set is saved', () => {
    vi.useFakeTimers();
    const { rerender } = render(<RestTimer timer={{ until: Date.now()+60000 }} onClose={vi.fn()}/>);
    expect(screen.getByText('01:00')).toBeTruthy();
    rerender(<RestTimer timer={{ until: Date.now()+120000 }} onClose={vi.fn()}/>);
    expect(screen.getByText('02:00')).toBeTruthy();
  });
});

it('keeps entered reps/weight/comment when durable local saving fails', async () => {
  const data = journal();data.workouts[0].status = 'draft';saveData(data);
  const user = userEvent.setup();await startApp();
  await user.click(screen.getByRole('button', { name: 'Продолжить тренировку' }));
  await user.clear(screen.getByPlaceholderText('Вес'));
  await user.type(screen.getByPlaceholderText('Вес'), '25');
  await user.type(screen.getByPlaceholderText('Повторы'), '10');
  await user.type(screen.getByPlaceholderText('Комментарий к следующему подходу (необязательно)'), 'Не потерять');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded'); });
  await user.click(screen.getByRole('button', { name: '+ Подход' }));
  expect((screen.getByPlaceholderText('Повторы') as HTMLInputElement).value).toBe('10');
  expect((screen.getByPlaceholderText('Вес') as HTMLInputElement).value).toBe('25');
  expect((screen.getByPlaceholderText('Комментарий к следующему подходу (необязательно)') as HTMLInputElement).value).toBe('Не потерять');
  expect(loadData().workouts[0].exercises[0].sets).toEqual(data.workouts[0].exercises[0].sets);
  expect(screen.getByText(/quota exceeded/)).toBeTruthy();
});
