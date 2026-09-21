import type { AppData } from './types';

const CONFIG_KEY = 'gym-log:config:v2';

function userStorageKey() {
  const telegramUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  return telegramUserId ? `gym-log:data:v2:${telegramUserId}` : 'gym-log:data:v2:browser-demo';
}

const DEFAULT_TYPES = [
  { id: 'legs' as const, name: 'Ноги', slug: 'legs' },
  { id: 'arms' as const, name: 'Руки', slug: 'arms' },
  { id: 'back_shoulders' as const, name: 'Спина + плечи', slug: 'back_shoulders' },
];

const DEFAULT_EXERCISES = [
  ['legs', 'Маятниковый присед', 'weight'], ['legs', 'Жим ногами лёжа', 'weight'], ['legs', 'Разгибание ног', 'weight'], ['legs', 'Сгибание ног сидя', 'weight'], ['legs', 'Сведение ног', 'weight'], ['legs', 'Икры', 'weight'], ['legs', 'Присед на одной ноге', 'weight'], ['legs', 'Отведение ноги назад', 'weight'],
  ['arms', 'Жим грифа (разминка)', 'weight'], ['arms', 'Жим от груди (тренажер)', 'weight'], ['arms', 'Разведение лёжа (грудь)', 'weight'], ['arms', 'Жим гантелей сидя', 'dumbbell'], ['arms', 'Разведение по диагонали', 'weight'], ['arms', 'Трицепс на блоке', 'weight'], ['arms', 'Сведение рук (Pec fly)', 'weight'], ['arms', 'Пресс (доп.)', 'weight'],
  ['back_shoulders', 'Подтягивания', 'assisted'], ['back_shoulders', 'Разведение в стороны (плечи)', 'weight'], ['back_shoulders', 'Тяга нижнего блока', 'weight'], ['back_shoulders', 'Тяга верхнего блока', 'weight'], ['back_shoulders', 'Тяга сидя', 'weight'], ['back_shoulders', 'Задняя дельта', 'weight'], ['back_shoulders', 'Гиперэкстензия', 'weight'], ['back_shoulders', 'Пресс (доп.)', 'weight'],
];

export function blankData(): AppData {
  return {
    workoutTypes: [...DEFAULT_TYPES],
    exercises: DEFAULT_EXERCISES.map(([workoutTypeId, name, loadType], i) => ({
      id: `default-${i + 1}`,
      workoutTypeId: workoutTypeId as AppData['exercises'][number]['workoutTypeId'],
      name,
      loadType: loadType as AppData['exercises'][number]['loadType'],
      sortOrder: i % 8 + 1,
      isActive: true,
    })),
    workouts: [],
  };
}

export function loadData(): AppData {
  const raw = localStorage.getItem(userStorageKey());
  if (!raw) return blankData();
  try { return JSON.parse(raw) as AppData; }
  catch { return blankData(); }
}

export function saveData(data: AppData) {
  localStorage.setItem(userStorageKey(), JSON.stringify(data));
}

export function resetDemo() {
  localStorage.removeItem(userStorageKey());
  localStorage.removeItem(CONFIG_KEY);
  location.reload();
}

export function getSettings() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}'); } catch { return {}; }
}
export function saveSettings(v: unknown) { localStorage.setItem(CONFIG_KEY, JSON.stringify(v)); }
