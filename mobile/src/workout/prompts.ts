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

interface FinishChoice {
  onFinish: () => void;
  onDiscard: () => void;
}

/** Finish straight away, or say what is missing first. */
export function confirmFinish(
  check: { completedSets: number; unfinishedSets: number },
  choice: FinishChoice,
): void {
  if (check.completedSets === 0) {
    Alert.alert('Nothing logged yet', 'Tick at least one set to finish, or discard this workout.', [
      { text: 'Keep logging', style: 'cancel' },
      { text: 'Discard workout', style: 'destructive', onPress: choice.onDiscard },
    ]);
    return;
  }
  if (check.unfinishedSets > 0) {
    const sets = check.unfinishedSets === 1 ? '1 set isn’t' : `${check.unfinishedSets} sets aren’t`;
    Alert.alert(`${sets} ticked`, 'Only ticked sets are saved.', [
      { text: 'Keep logging', style: 'cancel' },
      { text: 'Finish anyway', onPress: choice.onFinish },
    ]);
    return;
  }
  choice.onFinish();
}
