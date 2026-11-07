/**
 * The routine editor's draft: pure functions over a plain object, so every rule is tested
 * without rendering. Inputs are kept as the text the user typed (in their units) and only
 * turned into kg / seconds by `toPayload`, after `validateDraft` found no problems.
 */
import type {
  Exercise,
  ExerciseType,
  Routine,
  RoutineCreate,
  SetType,
  WeightUnit,
} from '@/api/types';
import { formatDuration, parseDuration } from '@/lib/format';
import { setInputs } from '@/lib/sets';
import {
  isLinkedWithNext as linkedWithNext,
  moveKeepingSupersets,
  toggleLinkWithNext,
  withRepairedSupersets,
} from '@/lib/supersets';
import { displayWeight, parseDecimal, weightToKg } from '@/lib/units';

// Server limits (docs/api.md § Routines).
export const MAX_EXERCISES = 50;
export const MAX_SETS = 30;
export const NAME_MAX = 80;
const MAX_WEIGHT_KG = 1000;
const MAX_REPS = 1000;
const MAX_DURATION_S = 24 * 3600;
const MAX_REP_TARGET = 100;

export interface DraftSet {
  key: string;
  setType: SetType;
  weight: string;
  reps: string;
  duration: string;
}

export interface DraftExercise {
  key: string;
  exerciseId: string;
  name: string;
  type: ExerciseType;
  supersetGroup: number | null;
  /** null = the user's default rest. */
  restSeconds: number | null;
  repMin: string;
  repMax: string;
  notes: string;
  sets: DraftSet[];
}

export interface RoutineDraft {
  name: string;
  notes: string;
  folderId: string | null;
  exercises: DraftExercise[];
}

let keyCounter = 0;

/** A React list key, unique for the app's lifetime. */
export function nextKey(): string {
  keyCounter += 1;
  return `k${keyCounter}`;
}

const text = (value: number | null): string => (value === null ? '' : String(value));

export function emptyDraft(folderId: string | null = null): RoutineDraft {
  return { name: '', notes: '', folderId, exercises: [] };
}

export function draftFromRoutine(routine: Routine, unit: WeightUnit): RoutineDraft {
  return {
    name: routine.name,
    notes: routine.notes,
    folderId: routine.folder_id,
    exercises: routine.exercises.map((e) => ({
      key: nextKey(),
      exerciseId: e.exercise_id,
      name: e.exercise_name,
      type: e.exercise_type,
      supersetGroup: e.superset_group,
      restSeconds: e.rest_seconds,
      repMin: text(e.rep_range_min),
      repMax: text(e.rep_range_max),
      notes: e.notes,
      sets: e.sets.map((s) => ({
        key: nextKey(),
        setType: s.set_type,
        weight: s.target_weight_kg === null ? '' : String(displayWeight(s.target_weight_kg, unit)),
        reps: text(s.target_reps),
        duration: s.target_duration_s === null ? '' : formatDuration(s.target_duration_s),
      })),
    })),
  };
}

function blankSet(): DraftSet {
  return { key: nextKey(), setType: 'normal', weight: '', reps: '', duration: '' };
}

function mapExercise(
  draft: RoutineDraft,
  key: string,
  change: (exercise: DraftExercise) => DraftExercise,
): RoutineDraft {
  return { ...draft, exercises: draft.exercises.map((e) => (e.key === key ? change(e) : e)) };
}

// --- supersets (rules in src/lib/supersets.ts) -----------------------------------------

export function isLinkedWithNext(draft: RoutineDraft, index: number): boolean {
  return linkedWithNext(draft.exercises, index);
}

/** Link an exercise with the one below it into a superset, or split them apart. */
export function toggleSupersetWithNext(draft: RoutineDraft, key: string): RoutineDraft {
  const index = draft.exercises.findIndex((e) => e.key === key);
  const exercises = toggleLinkWithNext(draft.exercises, index);
  return exercises === draft.exercises ? draft : { ...draft, exercises };
}

// --- exercises --------------------------------------------------------------------------

export function addExercises(
  draft: RoutineDraft,
  picked: Pick<Exercise, 'id' | 'name' | 'type'>[],
): RoutineDraft {
  const room = MAX_EXERCISES - draft.exercises.length;
  const added = picked.slice(0, Math.max(0, room)).map((e): DraftExercise => ({
    key: nextKey(),
    exerciseId: e.id,
    name: e.name,
    type: e.type,
    supersetGroup: null,
    restSeconds: null,
    repMin: '',
    repMax: '',
    notes: '',
    sets: [blankSet()],
  }));
  return { ...draft, exercises: [...draft.exercises, ...added] };
}

export function removeExercise(draft: RoutineDraft, key: string): RoutineDraft {
  return {
    ...draft,
    exercises: withRepairedSupersets(draft.exercises.filter((e) => e.key !== key)),
  };
}

/** Move an exercise one place without breaking any superset apart. */
export function moveExercise(draft: RoutineDraft, key: string, delta: -1 | 1): RoutineDraft {
  const index = draft.exercises.findIndex((e) => e.key === key);
  const exercises = moveKeepingSupersets(draft.exercises, index, delta);
  return exercises === draft.exercises ? draft : { ...draft, exercises };
}

export function updateExercise(
  draft: RoutineDraft,
  key: string,
  patch: Partial<Pick<DraftExercise, 'restSeconds' | 'repMin' | 'repMax' | 'notes'>>,
): RoutineDraft {
  return mapExercise(draft, key, (e) => ({ ...e, ...patch }));
}

// --- sets -------------------------------------------------------------------------------

/** A new set copies the last one's targets, as lifters usually repeat a set. */
export function addSet(draft: RoutineDraft, exerciseKey: string): RoutineDraft {
  return mapExercise(draft, exerciseKey, (e) => {
    if (e.sets.length >= MAX_SETS) return e;
    const last = e.sets[e.sets.length - 1];
    const set = last ? { ...last, key: nextKey(), setType: 'normal' as const } : blankSet();
    return { ...e, sets: [...e.sets, set] };
  });
}

export function removeSet(draft: RoutineDraft, exerciseKey: string, setKey: string): RoutineDraft {
  return mapExercise(draft, exerciseKey, (e) => ({
    ...e,
    sets: e.sets.filter((s) => s.key !== setKey),
  }));
}

export function updateSet(
  draft: RoutineDraft,
  exerciseKey: string,
  setKey: string,
  patch: Partial<Omit<DraftSet, 'key'>>,
): RoutineDraft {
  return mapExercise(draft, exerciseKey, (e) => ({
    ...e,
    sets: e.sets.map((s) => (s.key === setKey ? { ...s, ...patch } : s)),
  }));
}

// --- validation and payload -------------------------------------------------------------

export interface DraftErrors {
  name?: string;
  /** Exercise key → its first problem. */
  exercises: Record<string, string>;
}

const blank = (value: string) => value.trim() === '';

function parseCount(value: string): number | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

function exerciseProblem(e: DraftExercise, unit: WeightUnit): string | null {
  const min = blank(e.repMin) ? null : parseCount(e.repMin);
  const max = blank(e.repMax) ? null : parseCount(e.repMax);
  const badTarget = (n: number | null) => n === null || n < 1 || n > MAX_REP_TARGET;
  if (!blank(e.repMin) && badTarget(min)) return `Rep range must be 1–${MAX_REP_TARGET}`;
  if (!blank(e.repMax) && badTarget(max)) return `Rep range must be 1–${MAX_REP_TARGET}`;
  if (min !== null && max !== null && min > max) return 'Min reps must not be more than max reps';

  const inputs = setInputs(e.type);
  const maxWeight = displayWeight(MAX_WEIGHT_KG, unit);
  for (const [index, s] of e.sets.entries()) {
    const label = `Set ${index + 1}`;
    if (inputs.load && !blank(s.weight)) {
      const weight = parseDecimal(s.weight);
      if (weight === null || weight > maxWeight)
        return `${label}: weight must be 0–${maxWeight} ${unit}`;
    }
    if (inputs.reps && !blank(s.reps)) {
      const reps = parseCount(s.reps);
      if (reps === null || reps > MAX_REPS) return `${label}: reps must be a whole number`;
    }
    if (inputs.duration && !blank(s.duration)) {
      const seconds = parseDuration(s.duration);
      if (seconds === null || seconds > MAX_DURATION_S) return `${label}: time must look like 1:30`;
    }
  }
  return null;
}

export function validateDraft(draft: RoutineDraft, unit: WeightUnit): DraftErrors {
  const errors: DraftErrors = { exercises: {} };
  const name = draft.name.trim();
  if (!name) errors.name = 'Give the routine a name';
  else if (name.length > NAME_MAX) errors.name = `Use ${NAME_MAX} characters or fewer`;
  for (const e of draft.exercises) {
    const problem = exerciseProblem(e, unit);
    if (problem) errors.exercises[e.key] = problem;
  }
  return errors;
}

export function hasErrors(errors: DraftErrors): boolean {
  return errors.name !== undefined || Object.keys(errors.exercises).length > 0;
}

const orNull = <T>(value: string, parse: (v: string) => T | null): T | null =>
  blank(value) ? null : parse(value);

/** The API body for a draft that passed `validateDraft`. Only the type's targets are sent. */
export function toPayload(
  draft: RoutineDraft,
  unit: WeightUnit,
): Required<Omit<RoutineCreate, 'id'>> {
  return {
    name: draft.name.split(/\s+/).filter(Boolean).join(' '),
    notes: draft.notes.trim(),
    folder_id: draft.folderId,
    exercises: draft.exercises.map((e) => {
      const inputs = setInputs(e.type);
      return {
        exercise_id: e.exerciseId,
        superset_group: e.supersetGroup,
        rest_seconds: e.restSeconds,
        rep_range_min: orNull(e.repMin, parseCount),
        rep_range_max: orNull(e.repMax, parseCount),
        notes: e.notes.trim(),
        sets: e.sets.map((s) => ({
          set_type: s.setType,
          target_weight_kg: inputs.load
            ? orNull(s.weight, (v) => {
                const n = parseDecimal(v);
                return n === null ? null : weightToKg(n, unit);
              })
            : null,
          target_reps: inputs.reps ? orNull(s.reps, parseCount) : null,
          target_duration_s: inputs.duration ? orNull(s.duration, parseDuration) : null,
        })),
      };
    }),
  };
}
