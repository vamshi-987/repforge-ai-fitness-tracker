import type {
  ActivityLevel,
  Experience,
  Goal,
  LengthUnit,
  Profile,
  ProfileUpdate,
  Sex,
  WeightUnit,
} from '@/api/types';
import { formatHeight, formatWeight } from '@/lib/units';

/** Units come first so every later question is asked in the user's units. */
export const STEPS = [
  'units',
  'sex',
  'birth-date',
  'height',
  'weight',
  'activity',
  'goal',
  'experience',
] as const;
export type StepId = (typeof STEPS)[number];

/** Answers so far, in canonical units (kg, cm). Null = not answered (or invalid input). */
export interface OnboardingDraft {
  unitWeight: WeightUnit;
  unitLength: LengthUnit;
  sex: Sex | null;
  /** YYYY-MM-DD */
  birthDate: string | null;
  heightCm: number | null;
  weightKg: number | null;
  activityLevel: ActivityLevel | null;
  goal: Goal | null;
  experience: Experience | null;
}

export const EMPTY_DRAFT: OnboardingDraft = {
  unitWeight: 'kg',
  unitLength: 'cm',
  sex: null,
  birthDate: null,
  heightCm: null,
  weightKg: null,
  activityLevel: null,
  goal: null,
  experience: null,
};

/** Start from whatever the server already knows (units default to kg/cm). */
export function draftFromProfile(profile: Profile): OnboardingDraft {
  return {
    unitWeight: profile.unit_weight,
    unitLength: profile.unit_length,
    sex: profile.sex,
    birthDate: profile.birth_date,
    heightCm: profile.height_cm,
    weightKg: profile.weight_kg,
    activityLevel: profile.activity_level,
    goal: profile.goal,
    experience: profile.experience,
  };
}

export function isStepId(value: unknown): value is StepId {
  return typeof value === 'string' && (STEPS as readonly string[]).includes(value);
}

export function nextStep(step: StepId): StepId | null {
  return STEPS[STEPS.indexOf(step) + 1] ?? null;
}

export function previousStep(step: StepId): StepId | null {
  const index = STEPS.indexOf(step);
  return index > 0 ? (STEPS[index - 1] ?? null) : null;
}

export function isAnswered(step: StepId, draft: OnboardingDraft): boolean {
  switch (step) {
    case 'units':
      return true;
    case 'sex':
      return draft.sex !== null;
    case 'birth-date':
      return draft.birthDate !== null;
    case 'height':
      return draft.heightCm !== null;
    case 'weight':
      return draft.weightKg !== null;
    case 'activity':
      return draft.activityLevel !== null;
    case 'goal':
      return draft.goal !== null;
    case 'experience':
      return draft.experience !== null;
  }
}

export function firstUnanswered(draft: OnboardingDraft): StepId | null {
  return STEPS.find((step) => !isAnswered(step, draft)) ?? null;
}

const STEP_FOR_FIELD: Record<string, StepId> = {
  sex: 'sex',
  birth_date: 'birth-date',
  height_cm: 'height',
  weight_kg: 'weight',
  activity_level: 'activity',
  goal: 'goal',
  experience: 'experience',
};

/** Map the server's `onboarding_incomplete.details.missing` back to the first step to fix. */
export function stepForMissing(missing: unknown): StepId | null {
  if (!Array.isArray(missing)) return null;
  const steps = missing.map((field) => STEP_FOR_FIELD[String(field)]).filter(isStepId);
  return STEPS.find((step) => steps.includes(step)) ?? null;
}

/** The final PATCH /me/profile body. Only call once every step is answered. */
export function toProfileUpdate(draft: OnboardingDraft, timezone: string): ProfileUpdate {
  const { sex, birthDate, heightCm, weightKg, activityLevel, goal, experience } = draft;
  if (
    sex === null ||
    birthDate === null ||
    heightCm === null ||
    weightKg === null ||
    activityLevel === null ||
    goal === null ||
    experience === null
  ) {
    throw new Error(`Onboarding incomplete: ${firstUnanswered(draft) ?? 'unknown'}`);
  }
  return {
    unit_weight: draft.unitWeight,
    unit_length: draft.unitLength,
    sex,
    birth_date: birthDate,
    height_cm: heightCm,
    weight_kg: weightKg,
    activity_level: activityLevel,
    goal,
    experience,
    timezone,
    onboarding_complete: true,
  };
}

// --- validation, mirroring the API (services/profile.py and schemas/me.py) -----------------

export const MIN_AGE = 13;
export const MAX_AGE = 100;
export const HEIGHT_CM = { min: 100, max: 250 } as const;
export const WEIGHT_KG = { min: 25, max: 350 } as const;

export function ageOn(birth: Date, today: Date): number {
  const hadBirthday =
    today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
  return today.getFullYear() - birth.getFullYear() - (hadBirthday ? 0 : 1);
}

/** Validate day/month/year fields. Returns YYYY-MM-DD, or a problem to show. */
export function parseBirthDate(
  day: number,
  month: number,
  year: number,
  today: Date,
): { value: string } | { problem: string } {
  const date = new Date(year, month - 1, day);
  const real =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  if (!real) return { problem: 'That date does not exist.' };
  if (date > today) return { problem: 'Birth date is in the future.' };
  const age = ageOn(date, today);
  if (age < MIN_AGE) return { problem: `You must be at least ${MIN_AGE} to use RepForge.` };
  if (age > MAX_AGE) return { problem: `Enter an age of ${MAX_AGE} or less.` };
  const pad = (n: number) => String(n).padStart(2, '0');
  return { value: `${year}-${pad(month)}-${pad(day)}` };
}

export function heightProblem(cm: number, unit: LengthUnit): string | null {
  if (cm >= HEIGHT_CM.min && cm <= HEIGHT_CM.max) return null;
  return `Enter a height between ${formatHeight(HEIGHT_CM.min, unit)} and ${formatHeight(HEIGHT_CM.max, unit)}.`;
}

export function weightProblem(kg: number, unit: WeightUnit): string | null {
  if (kg >= WEIGHT_KG.min && kg <= WEIGHT_KG.max) return null;
  return `Enter a weight between ${formatWeight(WEIGHT_KG.min, unit)} and ${formatWeight(WEIGHT_KG.max, unit)}.`;
}
