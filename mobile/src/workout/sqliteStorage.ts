import { db } from '@/db/client';
import { activeWorkout } from '@/db/schema';

import type { ActiveWorkoutStorage } from './storage';

/** One row; a save replaces it in a single synchronous transaction. */
export const sqliteWorkoutStorage: ActiveWorkoutStorage = {
  async load() {
    return db.select().from(activeWorkout).limit(1).get()?.payload ?? null;
  },

  async save(workout) {
    db.transaction((tx) => {
      tx.delete(activeWorkout).run();
      tx.insert(activeWorkout)
        .values({ id: workout.id, payload: workout, updatedAt: new Date() })
        .run();
    });
  },

  async clear() {
    db.delete(activeWorkout).run();
  },
};
