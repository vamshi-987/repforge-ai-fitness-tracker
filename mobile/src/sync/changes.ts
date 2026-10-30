/** The outbox entry for each kind of local change (docs/api.md § Sync, the `data` shapes). */
import type {
  BodyMeasurement,
  BodyWeight,
  Exercise,
  Routine,
  RoutineFolder,
  SyncEntity,
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

export function deletion(entity: SyncEntity, id: string): QueuedChange {
  return { entity, entityId: id, op: 'delete', baseVersion: null, data: null };
}
