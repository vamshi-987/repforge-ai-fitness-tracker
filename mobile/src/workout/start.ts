import { router } from 'expo-router';
import { Alert } from 'react-native';

import type { Routine } from '@/api/types';
import { newId } from '@/lib/ids';
import { useActiveWorkout } from '@/stores/activeWorkout';

import { startEmpty, startFromRoutine } from './model';
import type { ActiveWorkout } from './types';

export const ACTIVE_WORKOUT_PATH = '/workout/active';

export function openActiveWorkout(): void {
  router.push(ACTIVE_WORKOUT_PATH);
}

/** Start a workout and open it; with one already in progress, ask what to do first. */
export function beginWorkout(make: () => ActiveWorkout): void {
  const { workout, start, end } = useActiveWorkout.getState();
  if (!workout) {
    start(make());
    openActiveWorkout();
    return;
  }
  Alert.alert(
    'Workout in progress',
    `“${workout.title}” isn't finished yet. Resume it, or discard it and start this one?`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard and start',
        style: 'destructive',
        onPress: () => {
          end();
          start(make());
          openActiveWorkout();
        },
      },
      { text: 'Resume', onPress: openActiveWorkout },
    ],
  );
}

export function startEmptyWorkout(): void {
  beginWorkout(() => startEmpty(newId(), Date.now()));
}

export function startRoutineWorkout(routine: Routine): void {
  beginWorkout(() => startFromRoutine(routine, newId, Date.now()));
}
