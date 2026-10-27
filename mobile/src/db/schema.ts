import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type {
  ExerciseType,
  RecordType,
  Routine,
  RoutineFolder,
  SetType,
  WorkoutVisibility,
} from '@/api/types';
import type { ActiveWorkout } from '@/workout/types';

/** Key/value store for sync cursors, ETags and other device-local bookkeeping. */
export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- exercise library mirror (GET /muscles, /equipment, /exercises) -----------------------
// A copy of the server's library plus the user's custom exercises, so search and the
// exercise screens work offline. Rows are replaced wholesale when the server's ETag changes.

export const muscles = sqliteTable('muscles', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  bodyMapKey: text('body_map_key').notNull(),
});

export const equipment = sqliteTable('equipment', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  incrementKg: real('increment_kg'),
});

export const exercises = sqliteTable('exercises', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').$type<ExerciseType>().notNull(),
  equipment: text('equipment').notNull(),
  primaryMuscle: text('primary_muscle').notNull(),
  secondaryMuscles: text('secondary_muscles', { mode: 'json' }).$type<string[]>().notNull(),
  instructions: text('instructions', { mode: 'json' }).$type<string[]>().notNull(),
  mediaVideoUrl: text('media_video_url'),
  mediaThumbUrl: text('media_thumb_url'),
  mediaLicense: text('media_license'),
  isCustom: integer('is_custom', { mode: 'boolean' }).notNull(),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull(),
  version: integer('version').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// --- routines mirror (GET /routines, /routine-folders) ------------------------------------
// The server's copy of the user's routines, so a routine can be started offline. Each row
// holds the API object as JSON: a routine is always read and written whole.

export const routines = sqliteTable('routines', {
  id: text('id').primaryKey(),
  payload: text('payload', { mode: 'json' }).$type<Routine>().notNull(),
});

export const routineFolders = sqliteTable('routine_folders', {
  id: text('id').primaryKey(),
  payload: text('payload', { mode: 'json' }).$type<RoutineFolder>().notNull(),
});

// --- the workout being logged (device-only until finished) --------------------------------
// At most one row. The whole live workout is saved as JSON on every change (debounced), so
// it survives the app being killed and is restored on the next launch.

export const activeWorkout = sqliteTable('active_workout', {
  id: text('id').primaryKey(),
  payload: text('payload', { mode: 'json' }).$type<ActiveWorkout>().notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- finished workouts (history) ---------------------------------------------------------
// Written when a workout is finished; mirrors the server's tables so Phase 4 can sync them.
// Times are epoch ms. Only completed sets are stored.

export const workouts = sqliteTable(
  'workouts',
  {
    id: text('id').primaryKey(),
    routineId: text('routine_id'),
    title: text('title').notNull(),
    notes: text('notes').notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at').notNull(),
    visibility: text('visibility').$type<WorkoutVisibility>().notNull(),
    totalVolumeKg: real('total_volume_kg').notNull(),
    totalSets: integer('total_sets').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
    /** Null until the server has it (Phase 4 sync). */
    syncedAt: integer('synced_at'),
  },
  (t) => [index('workouts_started_at_idx').on(t.startedAt)],
);

export const workoutExercises = sqliteTable(
  'workout_exercises',
  {
    id: text('id').primaryKey(),
    workoutId: text('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id').notNull(),
    /** Snapshot, so history reads well after an exercise is renamed or deleted. */
    name: text('name').notNull(),
    exerciseType: text('exercise_type').$type<ExerciseType>().notNull(),
    position: integer('position').notNull(),
    supersetGroup: integer('superset_group'),
    notes: text('notes').notNull(),
  },
  (t) => [
    index('workout_exercises_workout_id_idx').on(t.workoutId),
    index('workout_exercises_exercise_id_idx').on(t.exerciseId),
  ],
);

export const workoutSets = sqliteTable(
  'workout_sets',
  {
    id: text('id').primaryKey(),
    workoutExerciseId: text('workout_exercise_id')
      .notNull()
      .references(() => workoutExercises.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    setType: text('set_type').$type<SetType>().notNull(),
    weightKg: real('weight_kg'),
    reps: integer('reps'),
    durationS: integer('duration_s'),
    distanceM: real('distance_m'),
    rpe: real('rpe'),
    completed: integer('completed', { mode: 'boolean' }).notNull(),
  },
  (t) => [index('workout_sets_workout_exercise_id_idx').on(t.workoutExerciseId)],
);

/** Sets per muscle in a workout (primary 1, secondary 0.5), for the stats heat map. */
export const workoutMuscleSets = sqliteTable(
  'workout_muscle_sets',
  {
    workoutId: text('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    muscle: text('muscle').notNull(),
    sets: real('sets').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workoutId, t.muscle] })],
);

/** Every record a set or session reached; the best per (exercise, type) is the current PR. */
export const personalRecords = sqliteTable(
  'personal_records',
  {
    id: text('id').primaryKey(),
    exerciseId: text('exercise_id').notNull(),
    recordType: text('record_type').$type<RecordType>().notNull(),
    value: real('value').notNull(),
    workoutId: text('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    /** Null for records over a whole session (session volume). */
    workoutSetId: text('workout_set_id'),
    /** The best before this one; null when this was the first (a baseline, not a PR). */
    previousValue: real('previous_value'),
    achievedAt: integer('achieved_at').notNull(),
  },
  (t) => [
    index('personal_records_exercise_id_idx').on(t.exerciseId, t.recordType),
    index('personal_records_workout_id_idx').on(t.workoutId),
  ],
);
