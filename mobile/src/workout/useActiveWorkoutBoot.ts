import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useActiveWorkout, workoutStorage } from '@/stores/activeWorkout';

import { persistWorkout, type Persister } from './persist';

/**
 * Restore a workout left in progress, then save every change to SQLite. Pending changes are
 * written as soon as the app leaves the foreground, because a backgrounded app can be killed
 * without warning.
 */
export function useActiveWorkoutBoot(): void {
  useEffect(() => {
    let persister: Persister | null = null;
    let stopped = false;

    void useActiveWorkout
      .getState()
      .hydrate()
      .then(() => {
        if (!stopped) persister = persistWorkout(useActiveWorkout, workoutStorage);
      });

    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void persister?.flush();
    });

    return () => {
      stopped = true;
      subscription.remove();
      void persister?.flush();
      persister?.stop();
    };
  }, []);
}
