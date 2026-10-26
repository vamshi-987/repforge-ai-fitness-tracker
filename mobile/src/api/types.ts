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
