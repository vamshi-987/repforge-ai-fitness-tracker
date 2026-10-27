import type { Exercise } from '@/api/types';

type Deliver = (picked: Exercise[]) => void;

let pending: Deliver | null = null;

/**
 * Hands the exercise picker's choice back to the screen that opened it. A route can't take a
 * callback as a param, so the opener registers one here, then navigates to `/exercise-picker`.
 * Every opener registers its own, so a picker closed without adding leaves nothing stale.
 */
export const exercisePicker = {
  expect(onPick: Deliver): void {
    pending = onPick;
  },
  deliver(picked: Exercise[]): void {
    const callback = pending;
    pending = null;
    callback?.(picked);
  },
};
