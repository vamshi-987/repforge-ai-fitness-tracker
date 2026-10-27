/**
 * Showing and reading set values in the user's units. Sets store kg, metres and seconds.
 */
import type { ExerciseType, LengthUnit, WeightUnit } from '@/api/types';
import { formatDuration } from '@/lib/format';
import { roundTo, displayWeight } from '@/lib/units';
import { setInputs } from '@/lib/sets';

import type { PreviousSet } from './history';
import type { WorkoutSet } from './types';

export const METERS_PER_MILE = 1609.344; // exact, by definition

export interface Units {
  weight: WeightUnit;
  length: LengthUnit;
}

/** Distances are km for metric users and miles for imperial ones. */
export const distanceUnit = (length: LengthUnit): 'km' | 'mi' => (length === 'cm' ? 'km' : 'mi');

export function metersToDistance(meters: number, length: LengthUnit): number {
  return roundTo(length === 'cm' ? meters / 1000 : meters / METERS_PER_MILE, 2);
}

export function distanceToMeters(value: number, length: LengthUnit): number {
  return roundTo(length === 'cm' ? value * 1000 : value * METERS_PER_MILE, 1);
}

const trim = (n: number) => String(n);

/** "60 kg × 8", "+20 kg × 8", "× 12", "1:30", "5 km · 25:00" — or "—" when nothing. */
export function formatPrevious(
  type: ExerciseType,
  prev: PreviousSet | undefined,
  units: Units,
): string {
  if (!prev) return '—';
  const inputs = setInputs(type);
  const parts: string[] = [];
  if (inputs.load && prev.weightKg !== null) {
    const sign = inputs.load === 'added' ? '+' : inputs.load === 'assist' ? '−' : '';
    parts.push(`${sign}${trim(displayWeight(prev.weightKg, units.weight))} ${units.weight}`);
  }
  if (inputs.reps && prev.reps !== null)
    parts.push(parts.length ? `× ${prev.reps}` : `× ${prev.reps}`);
  const load = parts.join(' ');
  const rest: string[] = [];
  if (inputs.distance && prev.distanceM !== null)
    rest.push(
      `${trim(metersToDistance(prev.distanceM, units.length))} ${distanceUnit(units.length)}`,
    );
  if (inputs.duration && prev.durationS !== null) rest.push(formatDuration(prev.durationS));
  const text = [load, ...rest].filter(Boolean).join(' · ');
  return text || '—';
}

/** Ticking a set with empty inputs takes last session's values, as the placeholders showed. */
export function fillFromPrevious(set: WorkoutSet, prev: PreviousSet | undefined): WorkoutSet {
  if (!prev) return set;
  return {
    ...set,
    weightKg: set.weightKg ?? prev.weightKg,
    reps: set.reps ?? prev.reps,
    durationS: set.durationS ?? prev.durationS,
    distanceM: set.distanceM ?? prev.distanceM,
  };
}

/** "Set 2", "Warm-up set", "Drop set", "Failure set" from a set-column label. */
export function describeSet(label: string): string {
  if (label === 'W') return 'Warm-up set';
  if (label === 'D') return 'Drop set';
  if (label === 'F') return 'Failure set';
  return `Set ${label}`;
}

/** RPE choices: 6 to 10 in half steps. */
export const RPE_VALUES: readonly number[] = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
