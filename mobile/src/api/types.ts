/** Mirrors the backend schemas (docs/api.md). Weights are kg and lengths cm on the wire. */

export type AuthProvider = 'password' | 'google' | 'apple';
export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type Goal = 'muscle_gain' | 'fat_loss' | 'maintain';
export type Experience = 'beginner' | 'intermediate' | 'advanced';
export type WeightUnit = 'kg' | 'lb';
export type LengthUnit = 'cm' | 'in';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface User {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_private: boolean;
  is_pro: boolean;
  auth_provider: AuthProvider;
  created_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  /** Seconds. */
  expires_in: number;
  refresh_expires_in: number;
}

export interface AuthResponse extends TokenPair {
  user: User;
  is_new_user: boolean;
}

export interface Profile {
  sex: Sex | null;
  /** YYYY-MM-DD */
  birth_date: string | null;
  height_cm: number | null;
  /** Latest weigh-in. */
  weight_kg: number | null;
  activity_level: ActivityLevel | null;
  goal: Goal | null;
  experience: Experience | null;
  unit_weight: WeightUnit;
  unit_length: LengthUnit;
  water_goal_ml: number | null;
  timezone: string;
  onboarding_completed_at: string | null;
}

export interface Settings {
  theme: ThemePreference;
  default_rest_s: number;
  keep_awake: boolean;
  show_burned_kcal: boolean;
  water_cup_sizes: number[];
  water_reminder_every_h: number;
  /** HH:MM:SS */
  wake_time: string;
  sleep_time: string;
  reminders_enabled: boolean;
}

export interface Me extends User {
  profile: Profile;
  settings: Settings;
  onboarding_complete: boolean;
}

export interface MeUpdate {
  username?: string;
  display_name?: string;
  is_private?: boolean;
}

type NonNullFields<T> = { [K in keyof T]: NonNullable<T[K]> };

/** PATCH body: omitted = unchanged. Only `water_goal_ml` may be sent as null (= computed goal). */
export type ProfileUpdate = Partial<
  NonNullFields<Omit<Profile, 'onboarding_completed_at' | 'water_goal_ml'>>
> & {
  water_goal_ml?: number | null;
  onboarding_complete?: boolean;
};

export type SettingsUpdate = Partial<Settings>;

// --- exercise library (docs/api.md § Exercises) -----------------------------------------

export type ExerciseType =
  | 'weight_reps'
  | 'bodyweight_reps'
  | 'weighted_bodyweight'
  | 'assisted_bodyweight'
  | 'duration'
  | 'distance_duration';

export interface Muscle {
  id: string;
  slug: string;
  name: string;
  /** Region id in the body map (src/bodymap/regions.ts). */
  body_map_key: string;
}

export interface Equipment {
  id: string;
  slug: string;
  name: string;
  /** Smallest load step; null = progress by reps. */
  increment_kg: number | null;
}

export interface Exercise {
  id: string;
  name: string;
  type: ExerciseType;
  /** Slugs into Equipment / Muscle. */
  equipment: string;
  primary_muscle: string;
  secondary_muscles: string[];
  instructions: string[];
  media_video_url: string | null;
  media_thumb_url: string | null;
  media_license: string | null;
  is_custom: boolean;
  is_archived: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ExercisePage {
  items: Exercise[];
  next_cursor: string | null;
}

export interface ExerciseCreate {
  id?: string;
  name: string;
  type: ExerciseType;
  equipment: string;
  primary_muscle: string;
  secondary_muscles: string[];
  instructions: string[];
}

/** PATCH body; `type` may only be sent unchanged (it is immutable after save). */
export type ExerciseUpdate = Partial<Omit<ExerciseCreate, 'id'>>;

// --- routines (docs/api.md § Routines) --------------------------------------------------

export type SetType = 'warmup' | 'normal' | 'drop' | 'failure';

export interface RoutineSet {
  set_type: SetType;
  target_weight_kg: number | null;
  target_reps: number | null;
  target_duration_s: number | null;
}

export interface RoutineExercise {
  exercise_id: string;
  /** Read from the exercise, so the routine reads well even if it was deleted. */
  exercise_name: string;
  exercise_type: ExerciseType;
  /** Adjacent exercises with the same number form a superset. */
  superset_group: number | null;
  /** null = the user's default rest (settings.default_rest_s). */
  rest_seconds: number | null;
  rep_range_min: number | null;
  rep_range_max: number | null;
  notes: string;
  sets: RoutineSet[];
}

export interface Routine {
  id: string;
  folder_id: string | null;
  name: string;
  notes: string;
  position: number;
  exercises: RoutineExercise[];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface RoutineList {
  items: Routine[];
  /** null = unlimited (Pro). */
  routine_limit: number | null;
}

export interface RoutineFolder {
  id: string;
  name: string;
  position: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export type RoutineExerciseInput = Pick<RoutineExercise, 'exercise_id'> &
  Partial<Omit<RoutineExercise, 'exercise_id' | 'exercise_name' | 'exercise_type' | 'sets'>> & {
    sets?: Partial<RoutineSet>[];
  };

export interface RoutineCreate {
  id?: string;
  name: string;
  notes?: string;
  folder_id?: string | null;
  exercises?: RoutineExerciseInput[];
}

/** PATCH body: omitted = unchanged; `exercises` replaces the whole list. */
export type RoutineUpdate = Partial<Omit<RoutineCreate, 'id'>>;

// --- workouts ---------------------------------------------------------------------------

export type WorkoutVisibility = 'public' | 'followers' | 'private';

export type RecordType = 'heaviest' | 'e1rm' | 'best_set_volume' | 'session_volume' | 'most_reps';

/** A set of a finished workout, as the server stores it (docs/api.md § Workouts). */
export interface WorkoutSetOut {
  id: string;
  set_type: SetType;
  weight_kg: number | null;
  reps: number | null;
  duration_s: number | null;
  distance_m: number | null;
  rpe: number | null;
  completed: boolean;
}

export interface WorkoutExerciseOut {
  id: string;
  exercise_id: string;
  exercise_name: string;
  exercise_type: ExerciseType;
  superset_group: number | null;
  notes: string;
  sets: WorkoutSetOut[];
}

export interface RecordOut {
  exercise_id: string;
  record_type: RecordType;
  value: number;
  /** null = the first value (a baseline, not a PR). */
  previous_value: number | null;
  /** null for whole-session records (session volume). */
  set_id: string | null;
}

export interface Workout {
  id: string;
  routine_id: string | null;
  title: string;
  notes: string;
  started_at: string;
  ended_at: string;
  duration_s: number;
  visibility: WorkoutVisibility;
  total_volume_kg: number;
  total_sets: number;
  exercises: WorkoutExerciseOut[];
  /** Muscle slug → sets (primary 1, secondary 0.5). */
  muscle_sets: Record<string, number>;
  records: RecordOut[];
  version: number;
  created_at: string;
  updated_at: string;
}

/** PUT /workouts/{id} body: the whole finished workout. */
export interface WorkoutPut {
  title: string;
  notes: string;
  routine_id: string | null;
  started_at: string;
  ended_at: string;
  visibility: WorkoutVisibility;
  exercises: {
    exercise_id: string;
    superset_group: number | null;
    notes: string;
    sets: Omit<WorkoutSetOut, 'id'>[];
  }[];
}

// --- sync (docs/api.md § Sync) ------------------------------------------------------------

export type SyncEntity = 'exercise' | 'routine_folder' | 'routine' | 'workout';
export type SyncOp = 'upsert' | 'delete';

export interface SyncChange {
  entity: SyncEntity;
  id: string;
  op: SyncOp;
  /** The server version the edit started from; null for a row the device created. */
  base_version: number | null;
  /** When the edit was made on the device. */
  updated_at: string;
  data: Record<string, unknown> | null;
}

export interface SyncResult {
  entity: SyncEntity;
  id: string;
  status: 'applied' | 'stale' | 'rejected';
  /** True when the row doesn't exist on the server. */
  deleted: boolean;
  /** The server's copy after the change. */
  data: unknown;
  error: { code: string; message: string; details: unknown } | null;
}

export interface SyncPulled {
  entity: SyncEntity;
  id: string;
  change_seq: number;
  deleted: boolean;
  data: unknown;
}

export interface SyncPull {
  changes: SyncPulled[];
  cursor: number;
  has_more: boolean;
}

// --- stats (docs/api.md § Exercises, § Stats) ---------------------------------------------

/** How far back charts look; 1y and all need Pro. */
export type StatsRange = '1m' | '3m' | '1y' | 'all';

export interface ExercisePoint {
  workout_id: string;
  started_at: string;
  heaviest_kg: number | null;
  e1rm_kg: number | null;
  e1rm_low_accuracy: boolean;
  best_set_volume_kg: number | null;
  session_volume_kg: number | null;
  total_reps: number | null;
}

export interface ExerciseRecord {
  record_type: RecordType;
  value: number;
  workout_id: string;
  achieved_at: string;
}

export interface ExerciseStats {
  exercise_id: string;
  range: StatsRange;
  points: ExercisePoint[];
  records: ExerciseRecord[];
}
