/** Converting finished workouts between the device's shape and the API's (docs/api.md). */
import type { Workout, WorkoutPut } from '@/api/types';
import { withRepairedSupersets } from '@/lib/supersets';

import type { SavedWorkout, WorkoutExtras } from './history';

/** The PUT /workouts/{id} body for a workout saved on the device. */
export function toWorkoutPut(workout: SavedWorkout): WorkoutPut {
  return {
    title: workout.title,
    notes: workout.notes,
    routine_id: workout.routineId,
    started_at: new Date(workout.startedAt).toISOString(),
    ended_at: new Date(workout.endedAt).toISOString(),
    visibility: workout.visibility,
    // The server refuses a superset split by another exercise; repairing never drops data.
    exercises: withRepairedSupersets(workout.exercises).map((e) => ({
      exercise_id: e.exerciseId,
      superset_group: e.supersetGroup,
      notes: e.notes,
      sets: e.sets.map((s) => ({
        set_type: s.type,
        weight_kg: s.weightKg,
        reps: s.reps,
        duration_s: s.durationS,
        distance_m: s.distanceM,
        rpe: s.rpe,
        completed: s.completed,
      })),
    })),
  };
}

/** A server workout as the device stores it: its ids, totals and records are the server's. */
export function fromServerWorkout(workout: Workout): SavedWorkout & WorkoutExtras {
  const achievedAt = Date.parse(workout.ended_at);
  return {
    id: workout.id,
    routineId: workout.routine_id,
    title: workout.title,
    notes: workout.notes,
    startedAt: Date.parse(workout.started_at),
    endedAt: achievedAt,
    visibility: workout.visibility,
    volumeKg: workout.total_volume_kg,
    setCount: workout.total_sets,
    exercises: workout.exercises.map((e) => ({
      id: e.id,
      exerciseId: e.exercise_id,
      name: e.exercise_name,
      type: e.exercise_type,
      supersetGroup: e.superset_group,
      restSeconds: null,
      repRangeMin: null,
      repRangeMax: null,
      notes: e.notes,
      sets: e.sets.map((s) => ({
        id: s.id,
        type: s.set_type,
        weightKg: s.weight_kg,
        reps: s.reps,
        durationS: s.duration_s,
        distanceM: s.distance_m,
        rpe: s.rpe,
        completed: s.completed,
      })),
    })),
    muscleSets: { ...workout.muscle_sets },
    records: workout.records.map((r) => ({
      exerciseId: r.exercise_id,
      type: r.record_type,
      value: r.value,
      workoutId: workout.id,
      setId: r.set_id,
      previous: r.previous_value,
      achievedAt,
    })),
  };
}
