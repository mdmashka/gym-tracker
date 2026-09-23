export type WorkoutTypeId = 'legs' | 'arms' | 'back_shoulders';
export type LoadType = 'weight' | 'assisted' | 'dumbbell' | 'plate' | 'custom';

export interface WorkoutType {
  id: WorkoutTypeId;
  name: string;
  slug: string;
}

export interface Exercise {
  id: string;
  workoutTypeId: WorkoutTypeId;
  name: string;
  loadType: LoadType;
  sortOrder: number;
  isActive: boolean;
}

export interface SetEntry {
  id: string;
  order: number;
  weight: number | null;
  reps: number | null;
  comment?: string;
  loadMeta?: Record<string, unknown>;
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  order: number;
  skipped: boolean;
  notes?: string;
  sets: SetEntry[];
}

export interface Workout {
  id: string;
  typeId: WorkoutTypeId;
  date: string;
  status: 'draft' | 'completed';
  createdAt: string;
  completedAt?: string;
  exercises: WorkoutExercise[];
}

export interface AppSettings {
  restTimerSeconds: number;
}

export interface AppData {
  workoutTypes: WorkoutType[];
  exercises: Exercise[];
  workouts: Workout[];
  settings?: AppSettings;
}

export type Screen =
  | { kind: 'home' }
  | { kind: 'workout'; typeId: WorkoutTypeId; workoutId: string }
  | { kind: 'calendar' }
  | { kind: 'summary' }
  | { kind: 'settings' }
  | { kind: 'history'; workoutId: string };
