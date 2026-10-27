import { Alert } from 'react-native';

import { elapsedMs, formatAgo } from './time';
import type { ActiveWorkout } from './types';

interface ResumeChoice {
  onResume: () => void;
  onDiscard: () => void;
}

/** Shown once on launch when a workout survived the app being closed. */
export function askToResume(workout: ActiveWorkout, now: number, choice: ResumeChoice): void {
  Alert.alert(
    'Resume your workout?',
    `“${workout.title}” started ${formatAgo(elapsedMs(workout.startedAt, now))}. Pick up where you left off, or discard it.`,
    [
      { text: 'Discard', style: 'destructive', onPress: choice.onDiscard },
      { text: 'Resume', style: 'default', onPress: choice.onResume },
    ],
    { cancelable: false },
  );
}

export function confirmDiscard(onConfirm: () => void): void {
  Alert.alert('Discard workout?', 'Everything logged in this workout will be lost.', [
    { text: 'Keep logging', style: 'cancel' },
    { text: 'Discard', style: 'destructive', onPress: onConfirm },
  ]);
}
