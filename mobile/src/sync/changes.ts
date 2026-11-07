/** The outbox entry for each kind of local change (docs/api.md § Sync, the `data` shapes). */
import type {
  BodyMeasurement,
  BodyWeight,
  Exercise,
  Food,
  FoodLog,
  Routine,
  RoutineFolder,
  SavedMeal,
  SyncEntity,
  WaterLog,
} from '@/api/types';
import type { SavedWorkout } from '@/workout/history';
import { toWorkoutPut } from '@/workout/serverWorkout';

import type { QueuedChange } from './outbox';

/** Rows made on the device carry version 0 until the server has them. */
const baseVersion = (version: number): number | null => (version > 0 ? version : null);

export function exerciseChange(exercise: Exercise): QueuedChange {
  return {
    entity: 'exercise',
    entityId: exercise.id,
    op: 'upsert',
    baseVersion: baseVersion(exercise.version),
    data: {
      name: exercise.name,
      type: exercise.type,
      equipment: exercise.equipment,
      primary_muscle: exercise.primary_muscle,
      secondary_muscles: exercise.secondary_muscles,
      instructions: exercise.instructions,
    },
  };
}

export function folderChange(folder: RoutineFolder): QueuedChange {
  return {
    entity: 'routine_folder',
    entityId: folder.id,
    op: 'upsert',
    baseVersion: baseVersion(folder.version),
    data: { name: folder.name, position: folder.position },
  };
}

export function routineChange(routine: Routine): QueuedChange {
  return {
    entity: 'routine',
    entityId: routine.id,
    op: 'upsert',
    baseVersion: baseVersion(routine.version),
    data: {
      name: routine.name,
      notes: routine.notes,
      folder_id: routine.folder_id,
      position: routine.position,
      exercises: routine.exercises.map((e) => ({
        exercise_id: e.exercise_id,
        superset_group: e.superset_group,
        rest_seconds: e.rest_seconds,
        rep_range_min: e.rep_range_min,
        rep_range_max: e.rep_range_max,
        notes: e.notes,
        sets: e.sets,
      })),
    },
  };
}

export function workoutChange(workout: SavedWorkout, version = 0): QueuedChange {
  return {
    entity: 'workout',
    entityId: workout.id,
    op: 'upsert',
    baseVersion: baseVersion(version),
    data: { ...toWorkoutPut(workout) },
  };
}

export function weightChange(weight: BodyWeight): QueuedChange {
  return {
    entity: 'body_weight',
    entityId: weight.id,
    op: 'upsert',
    baseVersion: baseVersion(weight.version),
    data: { measured_at: weight.measured_at, weight_kg: weight.weight_kg, source: weight.source },
  };
}

export function measurementChange(measurement: BodyMeasurement): QueuedChange {
  return {
    entity: 'body_measurement',
    entityId: measurement.id,
    op: 'upsert',
    baseVersion: baseVersion(measurement.version),
    data: {
      measured_at: measurement.measured_at,
      kind: measurement.kind,
      value: measurement.value,
    },
  };
}

export function waterChange(log: WaterLog): QueuedChange {
  return {
    entity: 'water_log',
    entityId: log.id,
    op: 'upsert',
    baseVersion: baseVersion(log.version),
    data: { logged_at: log.logged_at, amount_ml: log.amount_ml },
  };
}

export function foodChange(food: Food): QueuedChange {
  return {
    entity: 'food',
    entityId: food.id,
    op: 'upsert',
    baseVersion: baseVersion(food.version),
    data: {
      name: food.name,
      brand: food.brand,
      barcode: food.barcode,
      kcal_100g: food.kcal_100g,
      protein_100g: food.protein_100g,
      carbs_100g: food.carbs_100g,
      fat_100g: food.fat_100g,
      fiber_100g: food.fiber_100g,
      servings: food.servings,
    },
  };
}

/** The whole log: the snapshot, plus only what the user typed over it. */
export function foodLogChange(log: FoodLog): QueuedChange {
  return {
    entity: 'food_log',
    entityId: log.id,
    op: 'upsert',
    baseVersion: baseVersion(log.version),
    data: {
      log_date: log.log_date,
      meal: log.meal,
      food_id: log.food_id,
      name: log.name,
      brand: log.brand,
      per_100g: log.per_100g,
      quantity: log.quantity,
      unit: log.unit,
      grams: log.grams,
      macros: log.macros_overridden
        ? {
            protein_g: log.protein_g,
            carbs_g: log.carbs_g,
            fat_g: log.fat_g,
            fiber_g: log.fiber_g,
          }
        : null,
      kcal: log.kcal_overridden ? log.kcal : null,
      source: log.source,
      photo_analysis_id: log.photo_analysis_id,
    },
  };
}

export function savedMealChange(meal: SavedMeal): QueuedChange {
  return {
    entity: 'saved_meal',
    entityId: meal.id,
    op: 'upsert',
    baseVersion: baseVersion(meal.version),
    data: {
      name: meal.name,
      items: meal.items.map(({ food_id, quantity, unit, grams }) => ({
        food_id,
        quantity,
        unit,
        grams,
      })),
    },
  };
}

export function deletion(entity: SyncEntity, id: string): QueuedChange {
  return { entity, entityId: id, op: 'delete', baseVersion: null, data: null };
}
