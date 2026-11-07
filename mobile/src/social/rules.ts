import type { FeedWorkout, Relation, WeightUnit } from '@/api/types';
import { formatWeight } from '@/lib/units';
import { formatAgo, formatDurationWords } from '@/workout/time';

const DAY_MS = 86_400_000;
const SHOWN_EXERCISES = 3;

/** "2 h ago" today, then a date. */
export function whenLabel(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (now - at < DAY_MS) return formatAgo(now - at);
  return new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function workoutLine(workout: FeedWorkout, unit: WeightUnit): string {
  const duration = Date.parse(workout.ended_at) - Date.parse(workout.started_at);
  return [
    formatDurationWords(duration),
    `${workout.total_sets} ${workout.total_sets === 1 ? 'set' : 'sets'}`,
    formatWeight(workout.total_volume_kg, unit),
  ].join(' · ');
}

/** "Bench Press × 3, Squat × 4 and 2 more". */
export function exerciseLine(workout: FeedWorkout): string {
  const shown = workout.exercises
    .slice(0, SHOWN_EXERCISES)
    .map((e) => `${e.name} × ${e.sets}`)
    .join(', ');
  const rest = workout.exercises.length - SHOWN_EXERCISES;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

export function followLabel(relation: Relation): string {
  if (relation === 'following') return 'Following';
  return relation === 'requested' ? 'Requested' : 'Follow';
}
