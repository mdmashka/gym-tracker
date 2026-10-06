import type { AppData, AppSettings, Exercise, WorkoutExercise, WorkoutType } from './types.ts';
import { blankData } from './defaults.ts';

const initialDefaults=blankData();

// Existing journals, including legacy journals without a flag, must never be reset.
export function needsOnboarding(data: AppData): boolean {
  return data.onboardingComplete === false && data.workouts.length === 0
    && JSON.stringify(data.workoutTypes)===JSON.stringify(initialDefaults.workoutTypes)
    && JSON.stringify(data.exercises)===JSON.stringify(initialDefaults.exercises);
}

export function completeOnboarding(data: AppData, workoutTypes: WorkoutType[], exercises: Exercise[], settings: AppSettings): AppData {
  if (!needsOnboarding(data)) {
    return { ...data, onboardingComplete: true, settings };
  }
  return { ...data, workoutTypes, exercises, onboardingComplete: true, settings };
}

export function exerciseName(data: AppData, exercise: WorkoutExercise): string {
  return exercise.customName ?? data.exercises.find(e => e.id === exercise.exerciseId)?.name ?? 'Удалённое упражнение';
}

export function saveTemplateExercises(data: AppData, target: string, draft: Exercise[]): AppData {
  const ordered = draft.map((e, i) => ({ ...e, workoutTypeId: target, sortOrder: i + 1, isActive: true }));
  const byId = new Map(ordered.map(e => [e.id, e]));
  return { ...data, exercises: [
    ...data.exercises.map(e => e.workoutTypeId !== target ? e : byId.get(e.id) ?? { ...e, isActive: false }),
    ...ordered.filter(e => !data.exercises.some(old => old.id === e.id)),
  ] };
}

export function deleteTemplate(data: AppData, id: string): AppData {
  // Keep historical names and exercise references even when the template is gone.
  return { ...data, workoutTypes: data.workoutTypes.filter(t => t.id !== id),
    workouts: data.workouts.map(w => w.typeId === id ? { ...w, name: w.name ?? data.workoutTypes.find(t => t.id === id)?.name } : w),
    exercises: data.exercises.map(e => e.workoutTypeId === id ? { ...e, isActive: false } : e),
  };
}

export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const timestamp = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const optionalTimestamp = (v: unknown) => v === undefined || timestamp(v);
const optionalText = (v: unknown) => v === undefined || typeof v === 'string';
const finiteOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));
const loads = ['weight', 'assisted', 'dumbbell', 'plate', 'custom', 'bodyweight'];
const uniqueObjects = (v: unknown): v is Record<string, unknown>[] => Array.isArray(v) && v.every(x => object(x) && text(x.id)) && new Set(v.map(x => x.id)).size === v.length;

// Allow legacy optional fields and orphaned historical references, never silently drop them.
export function isValidAppData(v: unknown): v is AppData {
  if (!object(v) || !uniqueObjects(v.workoutTypes) || !uniqueObjects(v.exercises) || !uniqueObjects(v.workouts)) return false;
  if (v.onboardingComplete !== undefined && typeof v.onboardingComplete !== 'boolean') return false;
  if (!v.workoutTypes.every(t => text(t.name) && typeof t.slug === 'string')) return false;
  if (!v.exercises.every(e => text(e.workoutTypeId) && text(e.name) && loads.includes(String(e.loadType)) && Number.isFinite(e.sortOrder) && typeof e.isActive === 'boolean')) return false;
  if (!v.workouts.every(w => text(w.typeId) && isDate(w.date) && ['draft', 'completed'].includes(String(w.status)) && timestamp(w.createdAt) && optionalTimestamp(w.updatedAt) && optionalTimestamp(w.completedAt) && optionalText(w.name) && uniqueObjects(w.exercises) && w.exercises.every(e =>
    text(e.exerciseId) && Number.isFinite(e.order) && typeof e.skipped === 'boolean' && optionalText(e.customName) && optionalText(e.notes) &&
    (e.loadType === undefined || ['weight', 'bodyweight'].includes(String(e.loadType))) && uniqueObjects(e.sets) && e.sets.every(s =>
      Number.isFinite(s.order) && finiteOrNull(s.weight) && finiteOrNull(s.reps) && optionalText(s.comment) &&
      (s.loadType === undefined || ['weight', 'bodyweight'].includes(String(s.loadType)))
    )
  ))) return false;
  if (v.settings !== undefined && (!object(v.settings) || !Number.isFinite(v.settings.restTimerSeconds) ||
    (v.settings.restTimerEnabled !== undefined && typeof v.settings.restTimerEnabled !== 'boolean') ||
    (v.settings.theme !== undefined && !['light', 'dark'].includes(String(v.settings.theme))) ||
    (v.settings.accentColor !== undefined && !['red', 'blue', 'green', 'purple', 'orange', 'teal', 'pink', 'yellow'].includes(String(v.settings.accentColor))))) return false;
  return true;
}
