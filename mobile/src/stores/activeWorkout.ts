import { create } from 'zustand';

import { sqliteWorkoutStorage } from '@/workout/sqliteStorage';
import type { ActiveWorkoutStorage } from '@/workout/storage';
import type { ActiveWorkout } from '@/workout/types';

export interface ActiveWorkoutState {
  workout: ActiveWorkout | null;
  /** False until storage was read on launch. */
  hydrated: boolean;
  /** A workout was restored on launch; the app asks to resume or discard it once. */
  restored: boolean;
  hydrate(): Promise<void>;
  /** Begin a workout. False (and no change) when one is already in progress. */
  start(workout: ActiveWorkout): boolean;
  /** Apply a change from `workout/model.ts`; ignored when no workout is in progress. */
  update(change: (workout: ActiveWorkout) => ActiveWorkout): void;
  acknowledgeRestore(): void;
  /** Stop the workout (finished and saved elsewhere, or discarded). */
  end(): void;
}

export function createActiveWorkoutStore(storage: ActiveWorkoutStorage) {
  let hydrating: Promise<void> | null = null;

  return create<ActiveWorkoutState>()((set, get) => ({
    workout: null,
    hydrated: false,
    restored: false,

    hydrate() {
      hydrating ??= storage
        .load()
        .catch(() => null)
        .then((saved) => {
          // A workout started before storage answered wins over the saved one.
          if (get().workout) set({ hydrated: true });
          else set({ workout: saved, hydrated: true, restored: saved !== null });
        });
      return hydrating;
    },

    start(workout) {
      if (get().workout) return false;
      set({ workout, restored: false });
      return true;
    },

    update(change) {
      const current = get().workout;
      if (current) set({ workout: change(current) });
    },

    acknowledgeRestore() {
      set({ restored: false });
    },

    end() {
      set({ workout: null, restored: false });
    },
  }));
}

export const workoutStorage: ActiveWorkoutStorage = sqliteWorkoutStorage;
export const useActiveWorkout = createActiveWorkoutStore(workoutStorage);

/** On sign-out: the next account must never see this one's workout. */
export async function forgetActiveWorkout(): Promise<void> {
  useActiveWorkout.getState().end();
  await workoutStorage.clear();
}
