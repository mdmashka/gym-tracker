import { blankData } from '../src/storage';
import { startWorkout } from '../src/utils';

export function journal() {
  const data = { ...blankData(), onboardingComplete: true };
  const workout = startWorkout(data, 'legs');
  workout.name = 'Сохранённая тренировка';
  workout.status = 'completed';
  workout.exercises[0].sets = [{ id: 'saved-set', order: 1, weight: 19.1, reps: 12, comment: 'original', loadType: 'weight' }];
  return { ...data, workouts: [workout] };
}
