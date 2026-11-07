/**
 * Every change to a live workout, as pure functions: (workout, …) → new workout. The store
 * applies them; tests call them directly. Ids come from the caller, so results are repeatable.
 */
import type { Exercise, Routine, SetType } from '@/api/types';
import { setInputs, setLabels } from '@/lib/sets';
import { moveKeepingSupersets, toggleLinkWithNext, withRepairedSupersets } from '@/lib/supersets';

import type { ActiveWorkout, WorkoutExercise, WorkoutSet } from './types';

export type IdSource = () => string;

const MAX_EXERCISES = 50;
const MAX_SETS = 30;

/** "Morning workout" before noon, "Afternoon workout" before 6 pm, else "Evening workout". */
export function defaultTitle(at: Date): string {
  const hour = at.getHours();
  if (hour >= 5 && hour < 12) return 'Morning workout';
  if (hour >= 12 && hour < 18) return 'Afternoon workout';
  return 'Evening workout';
}

function emptySet(id: string, type: SetType = 'normal'): WorkoutSet {
  return {
    id,
    type,
    weightKg: null,
    reps: null,
    durationS: null,
    distanceM: null,
    rpe: null,
    completed: false,
  };
}

export function startEmpty(id: string, now: number): ActiveWorkout {
  return {
    id,
    routineId: null,
    title: defaultTitle(new Date(now)),
    notes: '',
    startedAt: now,
    exercises: [],
  };
}

/** Routine targets become the starting values; nothing is ticked yet. */
export function startFromRoutine(routine: Routine, ids: IdSource, now: number): ActiveWorkout {
  return {
    id: ids(),
    routineId: routine.id,
    title: routine.name,
    notes: '',
    startedAt: now,
    exercises: withRepairedSupersets(
      routine.exercises.map((e): WorkoutExercise => ({
        id: ids(),
        exerciseId: e.exercise_id,
        name: e.exercise_name,
        type: e.exercise_type,
        supersetGroup: e.superset_group,
        restSeconds: e.rest_seconds,
        repRangeMin: e.rep_range_min,
        repRangeMax: e.rep_range_max,
        notes: e.notes,
        sets: e.sets.map((s) => ({
          ...emptySet(ids(), s.set_type),
          weightKg: s.target_weight_kg,
          reps: s.target_reps,
          durationS: s.target_duration_s,
        })),
      })),
    ),
  };
}

// --- workout ----------------------------------------------------------------------------

export function rename(workout: ActiveWorkout, title: string): ActiveWorkout {
  return { ...workout, title };
}

export function setWorkoutNotes(workout: ActiveWorkout, notes: string): ActiveWorkout {
  return { ...workout, notes };
}

// --- exercises --------------------------------------------------------------------------

function mapExercise(
  workout: ActiveWorkout,
  exerciseId: string,
  change: (exercise: WorkoutExercise) => WorkoutExercise,
): ActiveWorkout {
  return {
    ...workout,
    exercises: workout.exercises.map((e) => (e.id === exerciseId ? change(e) : e)),
  };
}

export function addExercises(
  workout: ActiveWorkout,
  picked: Pick<Exercise, 'id' | 'name' | 'type'>[],
  ids: IdSource,
): ActiveWorkout {
  const room = Math.max(0, MAX_EXERCISES - workout.exercises.length);
  const added = picked.slice(0, room).map((e): WorkoutExercise => ({
    id: ids(),
    exerciseId: e.id,
    name: e.name,
    type: e.type,
    supersetGroup: null,
    restSeconds: null,
    repRangeMin: null,
    repRangeMax: null,
    notes: '',
    sets: [emptySet(ids())],
  }));
  return { ...workout, exercises: [...workout.exercises, ...added] };
}

export function removeExercise(workout: ActiveWorkout, exerciseId: string): ActiveWorkout {
  return {
    ...workout,
    exercises: withRepairedSupersets(workout.exercises.filter((e) => e.id !== exerciseId)),
  };
}

export function moveExercise(
  workout: ActiveWorkout,
  exerciseId: string,
  delta: -1 | 1,
): ActiveWorkout {
  const index = workout.exercises.findIndex((e) => e.id === exerciseId);
  const exercises = moveKeepingSupersets(workout.exercises, index, delta);
  return exercises === workout.exercises ? workout : { ...workout, exercises };
}

export function toggleSupersetWithNext(workout: ActiveWorkout, exerciseId: string): ActiveWorkout {
  const index = workout.exercises.findIndex((e) => e.id === exerciseId);
  const exercises = toggleLinkWithNext(workout.exercises, index);
  return exercises === workout.exercises ? workout : { ...workout, exercises };
}

export function setExerciseNotes(
  workout: ActiveWorkout,
  exerciseId: string,
  notes: string,
): ActiveWorkout {
  return mapExercise(workout, exerciseId, (e) => ({ ...e, notes }));
}

// --- sets -------------------------------------------------------------------------------

/** A new set copies the last one's values as a normal set, as lifters usually repeat a set. */
export function addSet(workout: ActiveWorkout, exerciseId: string, id: string): ActiveWorkout {
  return mapExercise(workout, exerciseId, (e) => {
    if (e.sets.length >= MAX_SETS) return e;
    const last = e.sets[e.sets.length - 1];
    const set: WorkoutSet = last
      ? { ...last, id, type: 'normal', rpe: null, completed: false }
      : emptySet(id);
    return { ...e, sets: [...e.sets, set] };
  });
}

export function removeSet(
  workout: ActiveWorkout,
  exerciseId: string,
  setId: string,
): ActiveWorkout {
  return mapExercise(workout, exerciseId, (e) => ({
    ...e,
    sets: e.sets.filter((s) => s.id !== setId),
  }));
}

export type SetPatch = Partial<Omit<WorkoutSet, 'id'>>;

export function updateSet(
  workout: ActiveWorkout,
  exerciseId: string,
  setId: string,
  patch: SetPatch,
): ActiveWorkout {
  return mapExercise(workout, exerciseId, (e) => ({
    ...e,
    sets: e.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)),
  }));
}

export function findSet(
  workout: ActiveWorkout,
  exerciseId: string,
  setId: string,
): { exercise: WorkoutExercise; set: WorkoutSet; index: number } | null {
  const exercise = workout.exercises.find((e) => e.id === exerciseId);
  const index = exercise?.sets.findIndex((s) => s.id === setId) ?? -1;
  const set = exercise?.sets[index];
  return exercise && set ? { exercise, set, index } : null;
}

// --- derived ----------------------------------------------------------------------------

/** A set counts as logged when it is ticked and has the inputs its type needs. */
export function isLoggable(type: WorkoutExercise['type'], set: WorkoutSet): boolean {
  const inputs = setInputs(type);
  if (inputs.reps && set.reps === null) return false;
  if (inputs.duration && set.durationS === null) return false;
  if (inputs.distance && set.distanceM === null) return false;
  return true;
}

/** Volume = Σ weight × reps over ticked sets with a load (added weight counts; assistance doesn't). */
export function setVolumeKg(type: WorkoutExercise['type'], set: WorkoutSet): number {
  const { load } = setInputs(type);
  if (!set.completed || (load !== 'load' && load !== 'added')) return 0;
  return (set.weightKg ?? 0) * (set.reps ?? 0);
}

export interface WorkoutStats {
  volumeKg: number;
  completedSets: number;
  totalSets: number;
}

export function workoutStats(workout: ActiveWorkout): WorkoutStats {
  let volumeKg = 0;
  let completedSets = 0;
  let totalSets = 0;
  for (const e of workout.exercises) {
    for (const s of e.sets) {
      totalSets += 1;
      if (s.completed) completedSets += 1;
      volumeKg += setVolumeKg(e.type, s);
    }
  }
  return { volumeKg, completedSets, totalSets };
}

export interface NextSet {
  exercise: WorkoutExercise;
  set: WorkoutSet;
  /** "W", "1", "2", "D"… as shown in the set column. */
  label: string;
}

/** The first set not ticked yet, in screen order; null when everything is done. */
export function nextSet(workout: ActiveWorkout): NextSet | null {
  for (const exercise of workout.exercises) {
    const labels = setLabels(exercise.sets.map((s) => s.type));
    const index = exercise.sets.findIndex((s) => !s.completed);
    const set = exercise.sets[index];
    if (set) return { exercise, set, label: labels[index] ?? String(index + 1) };
  }
  return null;
}
