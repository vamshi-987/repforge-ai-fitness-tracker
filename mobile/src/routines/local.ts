/**
 * Routine changes made on the device. Each function mirrors what the server does for the
 * same change (docs/api.md § Routines), so the local copy matches what sync brings back.
 */
import type { Exercise, Routine, RoutineCreate, RoutineExercise, RoutineFolder } from '@/api/types';
import { repairSupersets } from '@/lib/supersets';
import { roundTo } from '@/lib/units';

export const NAME_MAX = 80;
const COPY_SUFFIX = ' (Copy)';

type Named = Pick<Exercise, 'id' | 'name' | 'type'>;

/** The fields to set; omitted ones keep the previous copy's values. */
export type RoutineFields = Partial<Omit<RoutineCreate, 'id'>> & { position?: number };

/**
 * The routine as the server would store it: exercise names and types read from the library
 * (or kept from the routine's previous copy, for a custom exercise deleted since), supersets
 * renumbered, weights at the server's precision. Version stays the server's (0 = never sent).
 */
export function buildRoutine(
  id: string,
  fields: RoutineFields,
  library: Named[],
  previous: Routine | null,
  now: string,
): Routine {
  const byId = new Map(library.map((e) => [e.id, e]));
  const known = new Map(previous?.exercises.map((e) => [e.exercise_id, e]) ?? []);
  const items = fields.exercises ?? previous?.exercises ?? [];
  const groups = repairSupersets(items.map((e) => e.superset_group ?? null));
  const exercises: RoutineExercise[] = items.map((e, index) => ({
    exercise_id: e.exercise_id,
    exercise_name: byId.get(e.exercise_id)?.name ?? known.get(e.exercise_id)?.exercise_name ?? '',
    exercise_type:
      byId.get(e.exercise_id)?.type ?? known.get(e.exercise_id)?.exercise_type ?? 'weight_reps',
    superset_group: groups[index] ?? null,
    rest_seconds: e.rest_seconds ?? null,
    rep_range_min: e.rep_range_min ?? null,
    rep_range_max: e.rep_range_max ?? null,
    notes: e.notes ?? '',
    sets: (e.sets ?? []).map((s) => ({
      set_type: s.set_type ?? 'normal',
      target_weight_kg: s.target_weight_kg == null ? null : roundTo(s.target_weight_kg, 2),
      target_reps: s.target_reps ?? null,
      target_duration_s: s.target_duration_s ?? null,
    })),
  }));
  return {
    id,
    folder_id: fields.folder_id === undefined ? (previous?.folder_id ?? null) : fields.folder_id,
    name: fields.name ?? previous?.name ?? '',
    notes: fields.notes ?? previous?.notes ?? '',
    position: fields.position ?? previous?.position ?? 0,
    exercises,
    version: previous?.version ?? 0,
    created_at: previous?.created_at ?? now,
    updated_at: now,
  };
}

/** Last place in a folder (or among routines without one). */
export function nextPosition(routines: Routine[], folderId: string | null): number {
  const positions = routines.filter((r) => r.folder_id === folderId).map((r) => r.position);
  return positions.length ? Math.max(...positions) + 1 : 0;
}

export function nextFolderPosition(folders: RoutineFolder[]): number {
  return folders.length ? Math.max(...folders.map((f) => f.position)) + 1 : 0;
}

/** "Push Day (Copy)", shortened so it still fits the name limit. */
export function copyName(name: string): string {
  return `${name.slice(0, NAME_MAX - COPY_SUFFIX.length).trimEnd()}${COPY_SUFFIX}`;
}

const byPlace = (a: Routine, b: Routine) =>
  a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/**
 * Put `ids`, in that order, into `folderId`; routines already there but not listed keep
 * their order after them. Returns only the routines whose folder or position changed.
 */
export function reorderRoutines(routines: Routine[], folderId: string | null, ids: string[]) {
  const byId = new Map(routines.map((r) => [r.id, r]));
  const listed = new Set(ids);
  const rest = routines.filter((r) => r.folder_id === folderId && !listed.has(r.id)).sort(byPlace);
  const ordered = [...ids.flatMap((id) => byId.get(id) ?? []), ...rest];
  return ordered.flatMap((routine, position) =>
    routine.folder_id === folderId && routine.position === position
      ? []
      : [{ ...routine, folder_id: folderId, position }],
  );
}

/** A deleted folder's routines move to the end of the routines without a folder. */
export function moveOutOfFolder(routines: Routine[], folderId: string): Routine[] {
  const start = nextPosition(routines, null);
  return routines
    .filter((r) => r.folder_id === folderId)
    .sort(byPlace)
    .map((routine, offset) => ({ ...routine, folder_id: null, position: start + offset }));
}

/** Listed folders first, in that order; the rest keep their order. Only changed ones. */
export function reorderFolders(folders: RoutineFolder[], ids: string[]): RoutineFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const listed = new Set(ids);
  const ordered = [
    ...ids.flatMap((id) => byId.get(id) ?? []),
    ...folders.filter((f) => !listed.has(f.id)).sort((a, b) => a.position - b.position),
  ];
  return ordered.flatMap((folder, position) =>
    folder.position === position ? [] : [{ ...folder, position }],
  );
}
