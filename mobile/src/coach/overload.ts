import type { OverloadSuggestion, SetType } from '@/api/types';
import { formatPrevious, type Units } from '@/workout/setValues';
import type { WorkoutExercise } from '@/workout/types';

/**
 * The ghost text for one set row. Targets are per working set, so warm-ups and drop sets don't
 * use one up; a finished set no longer needs one, and neither does a set beyond the target.
 */
export function setSuggestion(
  exercise: WorkoutExercise,
  index: number,
  suggestion: OverloadSuggestion | undefined,
  units: Units,
): string | null {
  const set = exercise.sets[index];
  if (!suggestion || !set || set.completed || !isWorking(set.type)) return null;
  const working = exercise.sets.slice(0, index).filter((s) => isWorking(s.type)).length;
  const target = suggestion.sets[working];
  if (!target) return null;
  if (target.weight_kg === null) return `Try ${target.reps} reps`;
  const text = formatPrevious(
    exercise.type,
    {
      type: set.type,
      weightKg: target.weight_kg,
      reps: target.reps,
      durationS: null,
      distanceM: null,
    },
    units,
  );
  return `Try ${text}`;
}

function isWorking(type: SetType): boolean {
  return type === 'normal' || type === 'failure';
}
