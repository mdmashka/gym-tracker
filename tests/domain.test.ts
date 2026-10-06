import { describe, expect, it } from 'vitest';
import { blankData } from '../src/storage';
import { completeOnboarding, deleteTemplate, exerciseName, isDate, isValidAppData, needsOnboarding, saveTemplateExercises } from '../src/domain';
import { buildExportRows } from '../src/utils';
import { journal } from './fixtures';

describe('journal preservation', () => {
  it('onboards a genuinely new user but never replays a legacy or existing journal', () => {
    expect(needsOnboarding(blankData())).toBe(true);
    const existing = journal();
    existing.onboardingComplete = false;
    expect(needsOnboarding(existing)).toBe(false);
    const legacy = { ...existing, onboardingComplete: undefined };
    expect(needsOnboarding(legacy)).toBe(false);
    const result = completeOnboarding(existing, [], [], { restTimerSeconds: 120, restTimerEnabled: true, theme: 'dark', accentColor: 'red' });
    expect(result.workouts).toEqual(existing.workouts);
    expect(result.exercises).toEqual(existing.exercises);
    expect(result.workoutTypes).toEqual(existing.workoutTypes);
  });
  it('keeps historical names and sets when the last template is deleted', () => {
    const original = journal();
    original.workoutTypes = original.workoutTypes.filter(t => t.id === 'legs');
    const result = deleteTemplate(original, 'legs');
    expect(result.workoutTypes).toEqual([]);
    expect(result.workouts[0].name).toBe(original.workouts[0].name);
    expect(result.workouts[0].exercises).toEqual(original.workouts[0].exercises);
    expect(exerciseName(result, result.workouts[0].exercises[0])).toBe('Маятниковый присед');
    expect(result.exercises.filter(e => e.workoutTypeId === 'legs').every(e => !e.isActive)).toBe(true);
  });
  it('orders mixed existing/new template exercises and retains removed historical exercises', () => {
    const data = journal();
    const old = data.exercises.find(e => e.workoutTypeId === 'legs')!;
    const added = { ...old, id: 'new', name: 'Новое' };
    const result = saveTemplateExercises(data, 'legs', [old, added]);
    expect(result.exercises.find(e => e.id === added.id)?.sortOrder).toBe(2);
    expect(result.exercises.find(e => e.id === old.id)?.sortOrder).toBe(1);
    expect(result.exercises.some(e => e.workoutTypeId === 'legs' && !e.isActive)).toBe(true);
    expect(result.workouts).toEqual(data.workouts);
  });
  it('exports custom and orphaned historical exercises without discarding their sets', () => {
    const data = journal();
    const we = data.workouts[0].exercises[0];
    we.exerciseId = 'one-off'; we.customName = 'Махи в кроссовере';
    expect(exerciseName(data, we)).toBe(we.customName);
    expect(buildExportRows(data)[1][2]).toBe(we.customName);
    delete we.customName;
    expect(buildExportRows(data)[1][2]).toBe('Удалённое упражнение');
  });
  it('validates legacy optional settings, empty templates and historical orphan references', () => {
    const data = journal();
    data.workoutTypes = [];
    data.settings = { restTimerSeconds: 120 } as typeof data.settings;
    expect(isValidAppData(data)).toBe(true);
    data.workouts[0].exercises[0].sets[0].weight = Infinity;
    expect(isValidAppData(data)).toBe(false);
    expect(isValidAppData({ workoutTypes: [], exercises: [], workouts: [{}] })).toBe(false);
  });
  it('rejects invalid dates rather than silently moving workouts to another month', () => {
    expect(isDate('2024-02-29')).toBe(true);
    expect(isDate('2025-02-29')).toBe(false);
    expect(isDate('2026-13-01')).toBe(false);
    expect(isDate('')).toBe(false);
  });
});

it('rejects malformed optional timestamps before they break history sorting', () => {
  const data = journal();
  expect(isValidAppData({ ...data, workouts: [{ ...data.workouts[0], updatedAt: 123 }] })).toBe(false);
  expect(isValidAppData({ ...data, workouts: [{ ...data.workouts[0], completedAt: 'not-a-date' }] })).toBe(false);
});

it('does not treat a customized zero-workout journal as a new user even with a false flag', () => {
  const data = blankData();data.workoutTypes.push({ id: 'personal', name: 'Личный шаблон', slug: 'personal' });
  expect(needsOnboarding(data)).toBe(false);
  const result = completeOnboarding(data, [], [], { restTimerSeconds: 120, restTimerEnabled: true, theme: 'dark', accentColor: 'red' });
  expect(result.workoutTypes).toEqual(data.workoutTypes);
  expect(result.exercises).toEqual(data.exercises);
});
