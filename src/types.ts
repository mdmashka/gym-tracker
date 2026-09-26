export type WorkoutTypeId = string;
export type LoadType = 'weight' | 'assisted' | 'dumbbell' | 'plate' | 'custom' | 'bodyweight';

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
  loadType?: 'weight' | 'bodyweight';
  comment?: string;
  loadMeta?: Record<string, unknown>;
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  customName?: string;
  order: number;
  skipped: boolean;
  loadType?: 'weight' | 'bodyweight';
  notes?: string;
  sets: SetEntry[];
}

export interface Workout {
  id: string;
  name?: string;
  typeId: WorkoutTypeId;
  date: string;
  status: 'draft' | 'completed';
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  exercises: WorkoutExercise[];
}

export type AppTheme = 'light' | 'dark';
export type AccentColor = 'red' | 'blue' | 'green' | 'purple' | 'orange' | 'teal' | 'pink';

export interface AppSettings {
  restTimerSeconds: number;
  restTimerEnabled: boolean;
  theme: AppTheme;
  accentColor: AccentColor;
}

export interface AppData {
  workoutTypes: WorkoutType[];
  exercises: Exercise[];
  workouts: Workout[];
  settings?: AppSettings;
  onboardingComplete?: boolean;
}

export type Screen =
  | { kind: 'home' }
  | { kind: 'workout'; typeId: WorkoutTypeId; workoutId: string; mode?: 'edit' }
  | { kind: 'calendar' }
  | { kind: 'summary' }
  | { kind: 'settings' }
  | { kind: 'history'; workoutId: string };
