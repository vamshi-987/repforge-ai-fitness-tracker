import type { RecordType, SetType, Workout, WorkoutVisibility } from '@/api/types';

import type { PreviousBests, RecordEntry } from './records';
import { fromServerWorkout } from './serverWorkout';
import type { WorkoutExercise } from './types';

/** A finished workout as stored on the device (only completed sets). */
export interface SavedWorkout {
  id: string;
  routineId: string | null;
  title: string;
  notes: string;
  startedAt: number;
  endedAt: number;
  visibility: WorkoutVisibility;
  volumeKg: number;
  setCount: number;
  exercises: WorkoutExercise[];
}

/** One set from the last session of an exercise, for the "Previous" column. */
export interface PreviousSet {
  type: SetType;
  weightKg: number | null;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
}

/** What is stored alongside a finished workout. */
export interface WorkoutExtras {
  /** Muscle slug → sets (primary 1, secondary 0.5). */
  muscleSets: Record<string, number>;
  /** Records reached in this workout (new bests only). */
  records: RecordEntry[];
}

/** The device's workout history. SQLite in the app, in memory in tests. */
export interface HistoryRepo {
  /** Exercise id → the sets of the latest finished workout that included it, in order. */
  previousSets(exerciseIds: string[]): Promise<Record<string, PreviousSet[]>>;
  /** Exercise id → the best value stored for each record type. */
  bestRecords(exerciseIds: string[]): Promise<PreviousBests>;
  /** Save a finished workout and its extras, all or nothing. */
  save(workout: SavedWorkout, extras: WorkoutExtras): Promise<void>;
  load(workoutId: string): Promise<(SavedWorkout & WorkoutExtras) | null>;
  /** Replace the local copy with the server's (its set ids, totals and records). */
  putServerWorkout(workout: Workout): Promise<void>;
  remove(workoutId: string): Promise<void>;
  /** Workouts the server has never confirmed (saved before sync existed, or still queued). */
  unsynced(): Promise<SavedWorkout[]>;
  /** Forget every workout, e.g. on sign-out. */
  clear(): Promise<void>;
}

const toPrevious = ({ type, weightKg, reps, durationS, distanceM }: PreviousSet): PreviousSet => ({
  type,
  weightKg,
  reps,
  durationS,
  distanceM,
});

export function createMemoryHistoryRepo(initial: SavedWorkout[] = []): HistoryRepo & {
  workouts: (SavedWorkout & WorkoutExtras)[];
  /** Workout id → the server's version and when it was synced (the SQLite columns). */
  sync: Map<string, { version: number; syncedAt: number | null }>;
} {
  const workouts: (SavedWorkout & WorkoutExtras)[] = initial.map((w) => ({
    ...w,
    muscleSets: {},
    records: [],
  }));
  const sync = new Map(initial.map((w) => [w.id, { version: 0, syncedAt: null as number | null }]));
  const without = (id: string) => {
    const index = workouts.findIndex((w) => w.id === id);
    if (index >= 0) workouts.splice(index, 1);
    sync.delete(id);
  };
  return {
    workouts,
    sync,
    async previousSets(exerciseIds) {
      const latestFirst = [...workouts].sort((a, b) => b.startedAt - a.startedAt);
      const result: Record<string, PreviousSet[]> = {};
      for (const id of new Set(exerciseIds)) {
        for (const workout of latestFirst) {
          const exercise = workout.exercises.find((e) => e.exerciseId === id);
          if (exercise) {
            result[id] = exercise.sets.filter((s) => s.completed).map(toPrevious);
            break;
          }
        }
      }
      return result;
    },
    async bestRecords(exerciseIds) {
      const wanted = new Set(exerciseIds);
      const bests: PreviousBests = {};
      for (const record of workouts.flatMap((w) => w.records)) {
        if (!wanted.has(record.exerciseId)) continue;
        const forExercise = (bests[record.exerciseId] ??= {});
        const type: RecordType = record.type;
        forExercise[type] = Math.max(forExercise[type] ?? 0, record.value);
      }
      return bests;
    },
    async save(workout, extras) {
      // JSON round trip, like SQLite: callers can't keep a live reference into the store.
      workouts.push(JSON.parse(JSON.stringify({ ...workout, ...extras })));
      sync.set(workout.id, { version: 0, syncedAt: null });
    },
    async load(workoutId) {
      return workouts.find((w) => w.id === workoutId) ?? null;
    },
    async putServerWorkout(workout) {
      without(workout.id);
      workouts.push(fromServerWorkout(workout));
      sync.set(workout.id, { version: workout.version, syncedAt: Date.now() });
    },
    async remove(workoutId) {
      without(workoutId);
    },
    async unsynced() {
      return workouts.filter((w) => sync.get(w.id)?.syncedAt === null);
    },
    async clear() {
      workouts.splice(0, workouts.length);
      sync.clear();
    },
  };
}
