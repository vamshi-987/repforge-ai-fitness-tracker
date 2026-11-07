import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import type {
  ExerciseType,
  FoodSource,
  LogSource,
  Meal,
  MeasurementKind,
  Per100g,
  SavedMealItem,
  Serving,
  TargetReason,
  WeightSource,
  RecordType,
  Routine,
  RoutineFolder,
  SetType,
  SyncEntity,
  SyncOp,
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
    /** The server's version; 0 until the server has it. Sent as base_version with edits. */
    version: integer('version').notNull().default(0),
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

// --- sync outbox ---------------------------------------------------------------------------
// Changes made on the device and not yet confirmed by the server (src/sync/outbox.ts). One
// row per synced row: a second edit replaces the queued state in place and keeps its turn.

export const outbox = sqliteTable(
  'outbox',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    entity: text('entity').$type<SyncEntity>().notNull(),
    entityId: text('entity_id').notNull(),
    op: text('op').$type<SyncOp>().notNull(),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>(),
    baseVersion: integer('base_version'),
    updatedAt: integer('updated_at').notNull(),
    revision: integer('revision').notNull(),
    attempts: integer('attempts').notNull(),
    nextTryAt: integer('next_try_at').notNull(),
  },
  (t) => [uniqueIndex('outbox_entity_row_idx').on(t.entity, t.entityId)],
);

// --- body (synced as body_weight / body_measurement) ---------------------------------------
// Times are epoch ms; version is the server's (0 until it has the row).

export const bodyWeights = sqliteTable(
  'body_weights',
  {
    id: text('id').primaryKey(),
    measuredAt: integer('measured_at').notNull(),
    weightKg: real('weight_kg').notNull(),
    source: text('source').$type<WeightSource>().notNull(),
    version: integer('version').notNull(),
  },
  (t) => [index('body_weights_measured_at_idx').on(t.measuredAt)],
);

export const bodyMeasurements = sqliteTable(
  'body_measurements',
  {
    id: text('id').primaryKey(),
    measuredAt: integer('measured_at').notNull(),
    kind: text('kind').$type<MeasurementKind>().notNull(),
    value: real('value').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [index('body_measurements_measured_at_idx').on(t.measuredAt)],
);

// --- water (synced as water_log) -----------------------------------------------------------

export const waterLogs = sqliteTable(
  'water_logs',
  {
    id: text('id').primaryKey(),
    loggedAt: integer('logged_at').notNull(),
    amountMl: integer('amount_ml').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [index('water_logs_logged_at_idx').on(t.loggedAt)],
);

// --- nutrition (synced as food / food_log / saved_meal) ------------------------------------
// `foods` holds the user's custom foods (synced) and library foods they've picked, so those
// work offline. Logs keep their own snapshot: no log ever reads from this table.

export const foods = sqliteTable(
  'foods',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    brand: text('brand'),
    source: text('source').$type<FoodSource>().notNull(),
    barcode: text('barcode'),
    kcal100g: real('kcal_100g').notNull(),
    protein100g: real('protein_100g').notNull(),
    carbs100g: real('carbs_100g').notNull(),
    fat100g: real('fat_100g').notNull(),
    fiber100g: real('fiber_100g'),
    servings: text('servings', { mode: 'json' }).$type<Serving[]>().notNull(),
    isCustom: integer('is_custom', { mode: 'boolean' }).notNull(),
    version: integer('version').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('foods_barcode_idx').on(t.barcode)],
);

export const foodLogs = sqliteTable(
  'food_logs',
  {
    id: text('id').primaryKey(),
    logDate: text('log_date').notNull(),
    meal: text('meal').$type<Meal>().notNull(),
    foodId: text('food_id'),
    name: text('name').notNull(),
    brand: text('brand'),
    per100g: text('per_100g', { mode: 'json' }).$type<Per100g>().notNull(),
    quantity: real('quantity').notNull(),
    unit: text('unit').notNull(),
    grams: real('grams').notNull(),
    kcal: real('kcal').notNull(),
    proteinG: real('protein_g').notNull(),
    carbsG: real('carbs_g').notNull(),
    fatG: real('fat_g').notNull(),
    fiberG: real('fiber_g'),
    macrosOverridden: integer('macros_overridden', { mode: 'boolean' }).notNull(),
    kcalOverridden: integer('kcal_overridden', { mode: 'boolean' }).notNull(),
    source: text('source').$type<LogSource>().notNull(),
    photoAnalysisId: text('photo_analysis_id'),
    version: integer('version').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('food_logs_log_date_idx').on(t.logDate),
    index('food_logs_created_at_idx').on(t.createdAt),
  ],
);

export const savedMeals = sqliteTable('saved_meals', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  items: text('items', { mode: 'json' }).$type<SavedMealItem[]>().notNull(),
  version: integer('version').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** The targets the server last gave, so the day view shows them offline. */
export const nutritionTargets = sqliteTable('nutrition_targets', {
  effectiveFrom: text('effective_from').primaryKey(),
  kcal: integer('kcal').notNull(),
  proteinG: integer('protein_g').notNull(),
  carbsG: integer('carbs_g').notNull(),
  fatG: integer('fat_g').notNull(),
  reason: text('reason').$type<TargetReason>().notNull(),
});
