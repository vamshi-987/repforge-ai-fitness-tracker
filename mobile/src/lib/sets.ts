import type { ExerciseType, SetType } from '@/api/types';

export const SET_TYPES: readonly SetType[] = ['warmup', 'normal', 'drop', 'failure'];

export const SET_TYPE_NAMES: Record<SetType, string> = {
  warmup: 'Warm-up',
  normal: 'Normal',
  drop: 'Drop set',
  failure: 'Failure',
};

/** Row labels: W, D and F for special sets; normal sets are numbered 1, 2, … */
export function setLabels(types: readonly SetType[]): string[] {
  let count = 0;
  return types.map((type) => {
    if (type === 'warmup') return 'W';
    if (type === 'drop') return 'D';
    if (type === 'failure') return 'F';
    count += 1;
    return String(count);
  });
}

/**
 * How a set's weight is meant: the load lifted, weight added to bodyweight (vest, belt),
 * assistance taken off bodyweight (band, machine), or no weight at all.
 */
export type LoadKind = 'load' | 'added' | 'assist' | null;

export interface SetInputs {
  load: LoadKind;
  reps: boolean;
  duration: boolean;
  distance: boolean;
}

/** Which inputs a set row shows for an exercise type (docs/api.md § Exercise object). */
export function setInputs(type: ExerciseType): SetInputs {
  switch (type) {
    case 'weight_reps':
      return { load: 'load', reps: true, duration: false, distance: false };
    case 'bodyweight_reps':
      return { load: null, reps: true, duration: false, distance: false };
    case 'weighted_bodyweight':
      return { load: 'added', reps: true, duration: false, distance: false };
    case 'assisted_bodyweight':
      return { load: 'assist', reps: true, duration: false, distance: false };
    case 'duration':
      return { load: null, reps: false, duration: true, distance: false };
    case 'distance_duration':
      return { load: null, reps: false, duration: true, distance: true };
  }
}

/** Column header for the weight input: "kg", "+kg", "−kg". */
export function loadHeader(kind: LoadKind, unit: string): string {
  if (kind === 'added') return `+${unit}`;
  if (kind === 'assist') return `−${unit}`;
  return unit;
}
