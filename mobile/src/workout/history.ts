import type { RecordType, SetType, Workout, WorkoutVisibility } from '@/api/types';

import type { PreviousBests, RecordEntry } from './records';
import { fromServerWorkout } from './serverWorkout';
import type { WorkoutExercise, WorkoutSet } from './types';

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

/** One row of the history list and the calendar. */
export interface WorkoutSummary {
  id: string;
  title: string;
  startedAt: number;
  endedAt: number;
  volumeKg: number;
  setCount: number;
  /** In workout order. */
  exerciseNames: string[];
  /** Records beaten in this workout (baselines don't count). */
  prCount: number;
}

/** One workout's sets of an exercise, for the exercise's history tab. */
export interface ExerciseSession {
  workoutId: string;
  title: string;
  startedAt: number;
  sets: WorkoutSet[];
}

export interface SyncInfo {
  /** The server's version; 0 until the server has the workout. */
  version: number;
  syncedAt: number | null;
}

export function summarize(workout: SavedWorkout & WorkoutExtras): WorkoutSummary {
  return {
    id: workout.id,
    title: workout.title,
    startedAt: workout.startedAt,
    endedAt: workout.endedAt,
    volumeKg: workout.volumeKg,
    setCount: workout.setCount,
    exerciseNames: workout.exercises.map((e) => e.name),
    prCount: workout.records.filter((r) => r.previous !== null).length,
  };
}

/** The device's workout history. SQLite in the app, in memory in tests. */
export interface HistoryRepo {
  /** Exercise id → the sets of the latest finished workout that included it, in order. */
  previousSets(exerciseIds: string[]): Promise<Record<string, PreviousSet[]>>;
  /** Exercise id → the best value stored for each record type, optionally leaving out one
   * workout's own records (when that workout is being edited). */
  bestRecords(exerciseIds: string[], exceptWorkoutId?: string): Promise<PreviousBests>;
  /** Save a finished workout and its extras, all or nothing. */
  save(workout: SavedWorkout, extras: WorkoutExtras): Promise<void>;
  load(workoutId: string): Promise<(SavedWorkout & WorkoutExtras) | null>;
  /** Newest first. */
  list(): Promise<WorkoutSummary[]>;
  /** Every session of one exercise, newest first (sets of an exercise done twice merged). */
  exerciseSessions(exerciseId: string): Promise<ExerciseSession[]>;
  syncInfo(workoutId: string): Promise<SyncInfo | null>;
  /** Replace an edited workout and its extras, keeping its sync state. */
  replace(workout: SavedWorkout, extras: WorkoutExtras): Promise<void>;
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
    async bestRecords(exerciseIds, exceptWorkoutId) {
      const wanted = new Set(exerciseIds);
      const bests: PreviousBests = {};
      for (const record of workouts
        .filter((w) => w.id !== exceptWorkoutId)
        .flatMap((w) => w.records)) {
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
    async list() {
      return [...workouts].sort((a, b) => b.startedAt - a.startedAt).map(summarize);
    },
    async exerciseSessions(exerciseId) {
      return [...workouts]
        .sort((a, b) => b.startedAt - a.startedAt)
        .flatMap((w) => {
          const sets = w.exercises
            .filter((e) => e.exerciseId === exerciseId)
            .flatMap((e) => e.sets);
          return sets.length
            ? [{ workoutId: w.id, title: w.title, startedAt: w.startedAt, sets }]
            : [];
        });
    },
    async syncInfo(workoutId) {
      return sync.get(workoutId) ?? null;
    },
    async replace(workout, extras) {
      const info = sync.get(workout.id) ?? { version: 0, syncedAt: null };
      without(workout.id);
      workouts.push(JSON.parse(JSON.stringify({ ...workout, ...extras })));
      sync.set(workout.id, info);
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
