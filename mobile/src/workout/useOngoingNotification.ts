import { useEffect } from 'react';

import { dismiss, showOngoing } from '@/notifications/notifier';
import { useActiveWorkout } from '@/stores/activeWorkout';

export const ONGOING_NOTIFICATION_ID = 'workout-in-progress';

/** "6:05 PM" in the phone's locale. */
export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Android: a sticky notification while a workout is in progress, so it is one tap away from
 * anywhere. It shows the start time; a live chronometer needs a native module (Phase 9).
 */
export function useOngoingNotification(): void {
  const id = useActiveWorkout((state) => state.workout?.id ?? null);

  useEffect(() => {
    const workout = useActiveWorkout.getState().workout;
    if (id === null || !workout) {
      void dismiss(ONGOING_NOTIFICATION_ID);
      return;
    }
    void showOngoing(
      ONGOING_NOTIFICATION_ID,
      workout.title,
      `Workout in progress since ${clockTime(workout.startedAt)}. Tap to open.`,
    );
  }, [id]);
}
