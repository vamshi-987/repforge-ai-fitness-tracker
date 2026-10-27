/**
 * Personal records and per-workout aggregates, computed on the device when a workout is
 * finished. Warm-up sets never count towards records.
 */
import type { Exercise, ExerciseType, RecordType } from '@/api/types';
import { epley } from '@/lib/e1rm';
import { setInputs } from '@/lib/sets';
import { roundTo } from '@/lib/units';

import type { WorkoutExercise, WorkoutSet } from './types';

export const RECORD_NAMES: Record<RecordType, string> = {
  heaviest: 'Heaviest weight',
  e1rm: 'Best estimated 1RM',
  best_set_volume: 'Best set volume',
  session_volume: 'Session volume',
  most_reps: 'Most reps',
};

/** Record types that are weights (shown in kg/lb); the rest are counts. */
export const WEIGHT_RECORDS: ReadonlySet<RecordType> = new Set([
  'heaviest',
  'e1rm',
  'best_set_volume',
  'session_volume',
]);

export interface Best {
  value: number;
  /** The set that reached it; null for whole-session records. */
  setId: string | null;
}

export type Bests = Partial<Record<RecordType, Best>>;

function keepMax(bests: Bests, type: RecordType, value: number | null, setId: string): void {
  if (value === null || value <= 0) return;
  const current = bests[type];
  if (!current || value > current.value) bests[type] = { value: roundTo(value, 2), setId };
}

/**
 * The best values this exercise reached in one workout. Loaded exercises track weight,
 * e1RM (barbell-style loads only) and volume; bodyweight-style exercises track reps.
 */
export function exerciseBests(type: ExerciseType, sets: WorkoutSet[]): Bests {
  const inputs = setInputs(type);
  const working = sets.filter((s) => s.completed && s.type !== 'warmup' && (s.reps ?? 0) > 0);
  const bests: Bests = {};
  let session = 0;
  for (const set of working) {
    const reps = set.reps ?? 0;
    const weight = set.weightKg ?? 0;
    if (inputs.load === 'load' || inputs.load === 'added') {
      keepMax(bests, 'heaviest', weight, set.id);
      keepMax(bests, 'best_set_volume', weight * reps, set.id);
      session += weight * reps;
    }
    if (inputs.load === 'load') keepMax(bests, 'e1rm', epley(weight, reps), set.id);
    if (inputs.reps && inputs.load !== 'load') keepMax(bests, 'most_reps', reps, set.id);
  }
  if (session > 0) bests.session_volume = { value: roundTo(session, 2), setId: null };
  return bests;
}

export interface RecordEntry {
  exerciseId: string;
  type: RecordType;
  value: number;
  workoutId: string;
  setId: string | null;
  /** The best before this one; null = first time (a baseline, not celebrated). */
  previous: number | null;
  achievedAt: number;
}

export interface PersonalRecord {
  exerciseId: string;
  exerciseName: string;
  type: RecordType;
  value: number;
  previous: number;
}

export type PreviousBests = Record<string, Partial<Record<RecordType, number>>>;

/**
 * Compare this workout's bests with the stored ones and return every new best. A first
 * value for a record type is stored as a baseline (`previous: null`).
 */
export function detectRecords(
  exercises: WorkoutExercise[],
  previous: PreviousBests,
  workoutId: string,
  achievedAt: number,
): RecordEntry[] {
  const entries: RecordEntry[] = [];
  // Track within this workout too, so an exercise done twice counts once.
  const known: PreviousBests = Object.fromEntries(
    Object.entries(previous).map(([id, bests]) => [id, { ...bests }]),
  );
  for (const exercise of exercises) {
    const bests = exerciseBests(exercise.type, exercise.sets);
    const before = (known[exercise.exerciseId] ??= {});
    for (const [type, best] of Object.entries(bests) as [RecordType, Best][]) {
      const old = before[type];
      if (old !== undefined && best.value <= old) continue;
      entries.push({
        exerciseId: exercise.exerciseId,
        type,
        value: best.value,
        workoutId,
        setId: best.setId,
        previous: old ?? null,
        achievedAt,
      });
      before[type] = best.value;
    }
  }
  return entries;
}

/** The records worth celebrating: improvements over an earlier best, in workout order. */
export function personalRecords(
  entries: RecordEntry[],
  exercises: Pick<WorkoutExercise, 'exerciseId' | 'name'>[],
): PersonalRecord[] {
  const names = new Map(exercises.map((e) => [e.exerciseId, e.name]));
  return entries.flatMap((entry) =>
    entry.previous === null
      ? []
      : [
          {
            exerciseId: entry.exerciseId,
            exerciseName: names.get(entry.exerciseId) ?? 'Exercise',
            type: entry.type,
            value: entry.value,
            previous: entry.previous,
          },
        ],
  );
}

/** Sets per muscle: each working set counts 1 for the primary muscle, 0.5 for each secondary. */
export function muscleSets(
  exercises: WorkoutExercise[],
  library: Pick<Exercise, 'id' | 'primary_muscle' | 'secondary_muscles'>[],
): Record<string, number> {
  const byId = new Map(library.map((e) => [e.id, e]));
  const totals: Record<string, number> = {};
  for (const exercise of exercises) {
    const info = byId.get(exercise.exerciseId);
    if (!info) continue;
    const sets = exercise.sets.filter((s) => s.completed && s.type !== 'warmup').length;
    if (sets === 0) continue;
    totals[info.primary_muscle] = (totals[info.primary_muscle] ?? 0) + sets;
    for (const muscle of info.secondary_muscles)
      totals[muscle] = (totals[muscle] ?? 0) + sets * 0.5;
  }
  return totals;
}
