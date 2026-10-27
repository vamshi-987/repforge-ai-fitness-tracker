import { useEffect } from 'react';

import { useNow } from '@/lib/useNow';
import { useActiveWorkout } from '@/stores/activeWorkout';
import { useRestTimer } from '@/stores/timer';

/**
 * App-wide rest timer duties, whatever screen is open: restore a running rest on launch,
 * notice when rest runs out in the foreground, and stop it when the workout ends.
 */
export function useRestTimerEffects(): void {
  const endsAt = useRestTimer((state) => state.endsAt);
  const now = useNow(500, endsAt !== null);

  useEffect(() => {
    void useRestTimer.getState().restore(Date.now());
  }, []);

  useEffect(() => {
    if (endsAt !== null && now >= endsAt) useRestTimer.getState().expire();
  }, [endsAt, now]);

  useEffect(
    () =>
      useActiveWorkout.subscribe((state, previous) => {
        if (previous.workout && !state.workout) useRestTimer.getState().skip();
      }),
    [],
  );
}
