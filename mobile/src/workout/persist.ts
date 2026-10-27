import type { ActiveWorkoutStorage } from './storage';
import type { ActiveWorkout } from './types';

/** The slice of the store the persister needs. */
export interface WorkoutSource {
  getState(): { workout: ActiveWorkout | null };
  subscribe(
    listener: (
      state: { workout: ActiveWorkout | null },
      previous: { workout: ActiveWorkout | null },
    ) => void,
  ): () => void;
}

export interface Persister {
  /** Write any pending change now (the app is going to the background). */
  flush(): Promise<void>;
  stop(): void;
}

export const SAVE_DELAY_MS = 300;

/**
 * Save the live workout to storage after every change, batched: the first unsaved change
 * schedules one write `delayMs` later, which saves the latest state, so typing a weight costs
 * one write, not one per keystroke. Ending the workout (null) is written at once, so a
 * finished or discarded workout can't come back after a kill. Writes run one at a time, in
 * order, and a failed write never blocks the next one.
 */
export function persistWorkout(
  source: WorkoutSource,
  storage: ActiveWorkoutStorage,
  delayMs = SAVE_DELAY_MS,
): Persister {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  // What storage already holds; hydration has just loaded it, so don't write it back.
  let written: ActiveWorkout | null = source.getState().workout;

  const cancelTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const write = (): Promise<void> => {
    cancelTimer();
    const workout = source.getState().workout;
    if (workout === written) return chain;
    written = workout;
    chain = chain
      .then(() => (workout ? storage.save(workout) : storage.clear()))
      .catch(() => undefined);
    return chain;
  };

  const unsubscribe = source.subscribe((state, previous) => {
    if (state.workout === previous.workout) return;
    if (state.workout === null) void write();
    else timer ??= setTimeout(() => void write(), delayMs);
  });

  return {
    flush: write,
    stop() {
      cancelTimer();
      unsubscribe();
    },
  };
}
