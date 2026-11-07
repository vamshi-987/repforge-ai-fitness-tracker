/**
 * Food log arithmetic, the same rules as the server's services/macros.py, so an entry shows
 * and saves its final numbers offline.
 *
 * A log is its per-100 g snapshot scaled to the grams eaten, unless the user edited it: edited
 * macros make calories follow as 4P + 4C + 9F; calories set by hand stay as typed ("manual").
 */
import type { Per100g } from '@/api/types';

export interface MacroOverride {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number | null;
}

export interface Amounts extends MacroOverride {
  kcal: number;
  macros_overridden: boolean;
  kcal_overridden: boolean;
}

export function kcalFromMacros(protein: number, carbs: number, fat: number): number {
  return 4 * protein + 4 * carbs + 9 * fat;
}

export function scale(per100g: number, grams: number): number {
  return (per100g * grams) / 100;
}

/** To 0.1, halves up; the epsilon keeps 0.15 (stored as 0.1499…) from rounding down. */
export function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

export function logAmounts(
  per100g: Per100g,
  grams: number,
  macros: MacroOverride | null = null,
  kcal: number | null = null,
): Amounts {
  const protein = macros ? macros.protein_g : scale(per100g.protein, grams);
  const carbs = macros ? macros.carbs_g : scale(per100g.carbs, grams);
  const fat = macros ? macros.fat_g : scale(per100g.fat, grams);
  const scaledFiber = per100g.fiber === null ? null : scale(per100g.fiber, grams);
  const fiber = macros ? macros.fiber_g : scaledFiber;
  const energy = macros ? kcalFromMacros(protein, carbs, fat) : scale(per100g.kcal, grams);
  return {
    kcal: round1(kcal ?? energy),
    protein_g: round1(protein),
    carbs_g: round1(carbs),
    fat_g: round1(fat),
    fiber_g: fiber === null ? null : round1(fiber),
    macros_overridden: macros !== null,
    kcal_overridden: kcal !== null,
  };
}
