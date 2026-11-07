import type { Routine, RoutineExercise, RoutineFolder } from '@/api/types';
import { formatRest } from '@/lib/format';

export interface RoutineSection {
  /** null = routines that aren't in a folder. */
  folder: RoutineFolder | null;
  routines: Routine[];
}

const byPosition = <T extends { position: number; created_at: string; id: string }>(a: T, b: T) =>
  a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/**
 * Routines without a folder first, then every folder in order (empty ones too, so they can
 * be filled). A routine whose folder isn't on this device yet is shown without one.
 */
export function groupRoutines(routines: Routine[], folders: RoutineFolder[]): RoutineSection[] {
  const sortedFolders = [...folders].sort(byPosition);
  const known = new Set(sortedFolders.map((f) => f.id));
  const sorted = [...routines].sort(byPosition);
  const loose = sorted.filter((r) => r.folder_id === null || !known.has(r.folder_id));
  const sections: RoutineSection[] = [];
  if (loose.length > 0 || sortedFolders.length === 0)
    sections.push({ folder: null, routines: loose });
  for (const folder of sortedFolders) {
    sections.push({ folder, routines: sorted.filter((r) => r.folder_id === folder.id) });
  }
  return sections;
}

/** "Bench Press, Squat, Pull-Up +2 more". */
export function routinePreview(routine: Routine, shown = 3): string {
  if (routine.exercises.length === 0) return 'No exercises yet';
  const names = routine.exercises.slice(0, shown).map((e) => e.exercise_name);
  const more = routine.exercises.length - shown;
  return more > 0 ? `${names.join(', ')} +${more} more` : names.join(', ');
}

function repRange(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) return min === max ? `${min} reps` : `${min}–${max} reps`;
  if (min !== null) return `${min}+ reps`;
  if (max !== null) return `up to ${max} reps`;
  return null;
}

/** "3 sets · 8–12 reps · Rest 2:00". */
export function exerciseSummary(exercise: RoutineExercise, defaultRestS: number): string {
  const count = exercise.sets.length;
  const rest = exercise.rest_seconds ?? defaultRestS;
  return [
    `${count} ${count === 1 ? 'set' : 'sets'}`,
    repRange(exercise.rep_range_min, exercise.rep_range_max),
    rest > 0 ? `Rest ${formatRest(rest)}` : 'No rest timer',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The ids with `id` moved one place up or down; null when it is already at that end. */
export function moveId(ids: string[], id: string, delta: -1 | 1): string[] | null {
  const index = ids.indexOf(id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target] as string, next[index] as string];
  return next;
}
