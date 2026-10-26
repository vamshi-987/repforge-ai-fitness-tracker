import { ApiError } from '@/api/client';
import type { Exercise, ExerciseCreate, ExerciseType, ExerciseUpdate } from '@/api/types';

/** Mirrors the server's limits (docs/api.md § POST /v1/exercises). */
export const NAME_MAX = 80;
export const MAX_SECONDARY = 6;
export const MAX_INSTRUCTIONS = 10;
export const INSTRUCTION_MAX = 300;

export const EXERCISE_TYPES: { value: ExerciseType; label: string; description: string }[] = [
  { value: 'weight_reps', label: 'Weight & reps', description: 'Bench press, curls, rows' },
  { value: 'bodyweight_reps', label: 'Reps only', description: 'Push-ups, sit-ups, band work' },
  {
    value: 'weighted_bodyweight',
    label: 'Bodyweight + added weight',
    description: 'Weighted pull-ups and dips',
  },
  {
    value: 'assisted_bodyweight',
    label: 'Assisted bodyweight',
    description: 'Machine or band assisted pull-ups',
  },
  { value: 'duration', label: 'Duration', description: 'Planks, wall sits' },
  { value: 'distance_duration', label: 'Distance & duration', description: 'Running, rowing' },
];

export function typeLabel(type: ExerciseType): string {
  return EXERCISE_TYPES.find((t) => t.value === type)?.label ?? type;
}

export interface ExerciseDraft {
  name: string;
  type: ExerciseType | null;
  equipment: string | null;
  primaryMuscle: string | null;
  secondaryMuscles: string[];
  /** One instruction per line. */
  instructionsText: string;
}

export type DraftField =
  'name' | 'type' | 'equipment' | 'primaryMuscle' | 'secondaryMuscles' | 'instructionsText';
export type DraftErrors = Partial<Record<DraftField, string>>;

export function draftFrom(exercise?: Exercise): ExerciseDraft {
  return {
    name: exercise?.name ?? '',
    type: exercise?.type ?? null,
    equipment: exercise?.equipment ?? null,
    primaryMuscle: exercise?.primary_muscle ?? null,
    secondaryMuscles: exercise?.secondary_muscles ?? [],
    instructionsText: exercise?.instructions.join('\n') ?? '',
  };
}

const collapse = (value: string) => value.split(/\s+/).filter(Boolean).join(' ');

export function instructionLines(text: string): string[] {
  return text.split('\n').map(collapse).filter(Boolean);
}

/** Choosing a muscle as primary removes it from the secondary list. */
export function withPrimary(draft: ExerciseDraft, slug: string): ExerciseDraft {
  return {
    ...draft,
    primaryMuscle: slug,
    secondaryMuscles: draft.secondaryMuscles.filter((s) => s !== slug),
  };
}

export function toggleSecondary(draft: ExerciseDraft, slug: string): ExerciseDraft {
  const has = draft.secondaryMuscles.includes(slug);
  return {
    ...draft,
    secondaryMuscles: has
      ? draft.secondaryMuscles.filter((s) => s !== slug)
      : [...draft.secondaryMuscles, slug].sort(),
  };
}

export function validateDraft(draft: ExerciseDraft): DraftErrors {
  const errors: DraftErrors = {};
  const name = collapse(draft.name);
  if (!name) errors.name = 'Give the exercise a name.';
  else if (name.length > NAME_MAX) errors.name = `Keep the name to ${NAME_MAX} characters.`;
  if (!draft.type) errors.type = 'Choose how sets are logged.';
  if (!draft.equipment) errors.equipment = 'Choose the equipment.';
  if (!draft.primaryMuscle) errors.primaryMuscle = 'Choose the main muscle worked.';
  if (draft.secondaryMuscles.length > MAX_SECONDARY)
    errors.secondaryMuscles = `Pick up to ${MAX_SECONDARY} secondary muscles.`;
  const lines = instructionLines(draft.instructionsText);
  if (lines.length > MAX_INSTRUCTIONS)
    errors.instructionsText = `Use up to ${MAX_INSTRUCTIONS} lines.`;
  else if (lines.some((l) => l.length > INSTRUCTION_MAX))
    errors.instructionsText = `Keep each line to ${INSTRUCTION_MAX} characters.`;
  return errors;
}

/** Call only after `validateDraft` returned no errors. */
export function toCreate(draft: ExerciseDraft, id?: string): ExerciseCreate {
  return {
    ...(id ? { id } : {}),
    name: collapse(draft.name),
    type: draft.type as ExerciseType,
    equipment: draft.equipment as string,
    primary_muscle: draft.primaryMuscle as string,
    secondary_muscles: draft.secondaryMuscles,
    instructions: instructionLines(draft.instructionsText),
  };
}

/** Only the fields that changed; never `type` (immutable after save). */
export function toUpdate(draft: ExerciseDraft, original: Exercise): ExerciseUpdate {
  const next = toCreate(draft);
  const patch: ExerciseUpdate = {};
  if (next.name !== original.name) patch.name = next.name;
  if (next.equipment !== original.equipment) patch.equipment = next.equipment;
  if (next.primary_muscle !== original.primary_muscle) patch.primary_muscle = next.primary_muscle;
  if (next.secondary_muscles.join() !== [...original.secondary_muscles].sort().join())
    patch.secondary_muscles = next.secondary_muscles;
  if (next.instructions.join('\n') !== original.instructions.join('\n'))
    patch.instructions = next.instructions;
  return patch;
}

const SERVER_FIELDS: Record<string, DraftField> = {
  name: 'name',
  type: 'type',
  equipment: 'equipment',
  primary_muscle: 'primaryMuscle',
  secondary_muscles: 'secondaryMuscles',
  instructions: 'instructionsText',
};

/** Field errors from a server 422, so they show next to the right input. */
export function serverFieldErrors(error: unknown): DraftErrors {
  if (!(error instanceof ApiError) || error.code !== 'validation_error') return {};
  const errors: DraftErrors = {};
  for (const detail of Array.isArray(error.details) ? error.details : []) {
    const loc = (detail as { loc?: unknown[] }).loc;
    const field = typeof loc?.[1] === 'string' ? SERVER_FIELDS[loc[1]] : undefined;
    const msg = (detail as { msg?: unknown }).msg;
    if (field && !errors[field]) errors[field] = typeof msg === 'string' ? msg : 'Invalid value';
  }
  return errors;
}

export function friendlyError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'network_error')
    return "You're offline. Custom exercises can be changed once you're back online.";
  if (error instanceof ApiError && error.message) return error.message;
  return 'Something went wrong. Try again.';
}
