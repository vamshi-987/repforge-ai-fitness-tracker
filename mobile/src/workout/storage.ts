import type { ActiveWorkout } from './types';

/** Where the live workout is kept between launches. SQLite in the app, in memory in tests. */
export interface ActiveWorkoutStorage {
  load(): Promise<ActiveWorkout | null>;
  save(workout: ActiveWorkout): Promise<void>;
  clear(): Promise<void>;
}

/** Stores JSON text, like SQLite does, so tests catch anything that wouldn't survive a save. */
export function createMemoryWorkoutStorage(): ActiveWorkoutStorage & { saves: number } {
  let saved: string | null = null;
  const storage = {
    saves: 0,
    async load() {
      return saved === null ? null : (JSON.parse(saved) as ActiveWorkout);
    },
    async save(workout: ActiveWorkout) {
      saved = JSON.stringify(workout);
      storage.saves += 1;
    },
    async clear() {
      saved = null;
    },
  };
  return storage;
}
