import type { FoodLog, Per100g, Serving, TargetsUpdate } from '@/api/types';
import { logAmounts, type Amounts, type MacroOverride } from '@/lib/macros';

import type { FoodFields } from './actions';
import { formatAmount, parseNumber } from './rules';

// The server's limits (docs/api.md § Food logs): a change it would refuse never gets queued.
const MAX_AMOUNT = 20_000;
const MAX_MACRO_G = 5000;
const MAX_KCAL = 50_000;
const MAX_KCAL_100G = 900;
const MAX_SERVING_G = 5000;

// --- a log entry ----------------------------------------------------------------------------

export interface MacroText {
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
}

export interface EntryForm {
  quantity: string;
  unit: string;
  /** Null until a macro is edited: the amounts follow the food. */
  macros: MacroText | null;
  /** Null until calories are typed: they follow the food, or the edited macros. */
  kcal: string | null;
}

export interface EntryValues {
  quantity: number;
  unit: string;
  grams: number;
  macros: MacroOverride | null;
  kcal: number | null;
  amounts: Amounts;
  error: string | null;
}

export function formFromLog(log: FoodLog): EntryForm {
  return {
    quantity: formatAmount(log.quantity),
    unit: log.unit,
    macros: log.macros_overridden
      ? {
          protein: formatAmount(log.protein_g),
          carbs: formatAmount(log.carbs_g),
          fat: formatAmount(log.fat_g),
          fiber: log.fiber_g === null ? '' : formatAmount(log.fiber_g),
        }
      : null,
    kcal: log.kcal_overridden ? formatAmount(log.kcal) : null,
  };
}

/** The form with one macro changed; the first edit starts from the amounts on screen. */
export function withMacro(
  form: EntryForm,
  amounts: Amounts,
  field: keyof MacroText,
  text: string,
): EntryForm {
  const macros = form.macros ?? {
    protein: formatAmount(amounts.protein_g),
    carbs: formatAmount(amounts.carbs_g),
    fat: formatAmount(amounts.fat_g),
    fiber: amounts.fiber_g === null ? '' : formatAmount(amounts.fiber_g),
  };
  return { ...form, macros: { ...macros, [field]: text } };
}

function readMacros(text: MacroText): { macros: MacroOverride; valid: boolean } {
  const grams = (value: string) => (value.trim() === '' ? 0 : parseNumber(value));
  const fiberBlank = text.fiber.trim() === '';
  const values = [grams(text.protein), grams(text.carbs), grams(text.fat), grams(text.fiber)];
  const [protein_g, carbs_g, fat_g, fiber_g] = values;
  return {
    macros: {
      protein_g: protein_g ?? 0,
      carbs_g: carbs_g ?? 0,
      fat_g: fat_g ?? 0,
      fiber_g: fiberBlank ? null : (fiber_g ?? 0),
    },
    valid: values.every((v) => v !== null && v <= MAX_MACRO_G),
  };
}

/** What the form means right now. `error` blocks saving; amounts are always shown. */
export function readEntry(form: EntryForm, units: Serving[], per100g: Per100g): EntryValues {
  const quantity = parseNumber(form.quantity);
  const unitGrams = units.find((u) => u.label === form.unit)?.grams ?? 1;
  const grams = Math.round((quantity ?? 0) * unitGrams * 100) / 100;
  const typed = form.macros ? readMacros(form.macros) : null;
  const macros = typed?.macros ?? null;
  const kcalBlank = form.kcal === null || form.kcal.trim() === '';
  const kcal = kcalBlank ? null : parseNumber(form.kcal ?? '');

  let error: string | null = null;
  if (quantity === null || grams <= 0) error = 'Enter an amount';
  else if (quantity > MAX_AMOUNT || grams > MAX_AMOUNT) error = 'That amount is too large';
  else if (typed && !typed.valid) error = 'Macros must be numbers up to 5000 g';
  else if (!kcalBlank && (kcal === null || kcal > MAX_KCAL)) error = 'Check the calories';

  return {
    quantity: quantity ?? 0,
    unit: form.unit,
    grams,
    macros,
    kcal,
    amounts: logAmounts(per100g, grams, macros, kcal),
    error,
  };
}

// --- a custom food --------------------------------------------------------------------------

export interface ServingText {
  label: string;
  grams: string;
}

export interface CustomFoodForm {
  name: string;
  brand: string;
  barcode: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
  servings: ServingText[];
}

export type CustomFoodErrors = Partial<Record<keyof CustomFoodForm, string>>;

export function readCustomFood(
  form: CustomFoodForm,
): { fields: FoodFields; errors: null } | { fields: null; errors: CustomFoodErrors } {
  const errors: CustomFoodErrors = {};
  const name = form.name.trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Give it a name';
  const barcode = form.barcode.trim();
  if (barcode && !/^\d{8,14}$/.test(barcode)) errors.barcode = 'Use 8–14 digits';

  const per100 = (key: 'kcal' | 'protein' | 'carbs' | 'fat' | 'fiber', max: number) => {
    const value = parseNumber(form[key]);
    if (value === null || value > max) errors[key] = `Use 0–${max}`;
    return value ?? 0;
  };
  const kcal_100g = per100('kcal', MAX_KCAL_100G);
  const protein_100g = per100('protein', 100);
  const carbs_100g = per100('carbs', 100);
  const fat_100g = per100('fat', 100);
  const fiber_100g = form.fiber.trim() === '' ? null : per100('fiber', 100);

  const servings = form.servings
    .filter((s) => s.label.trim() !== '' || s.grams.trim() !== '')
    .map((s) => ({ label: s.label.trim(), grams: parseNumber(s.grams) ?? 0 }));
  if (servings.some((s) => !s.label || s.grams <= 0 || s.grams > MAX_SERVING_G)) {
    errors.servings = 'Each serving needs a name and 1–5000 g';
  }

  if (Object.keys(errors).length > 0) return { fields: null, errors };
  return {
    errors: null,
    fields: {
      name,
      brand: form.brand.trim() || null,
      barcode: barcode || null,
      kcal_100g,
      protein_100g,
      carbs_100g,
      fat_100g,
      fiber_100g,
      servings,
    },
  };
}

// --- daily targets --------------------------------------------------------------------------

export interface TargetsForm {
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
}

export type TargetsErrors = Partial<Record<keyof TargetsForm, string>>;

/** The server's limits; it also refuses calories below the user's own safe minimum. */
export function readTargets(
  form: TargetsForm,
): { fields: TargetsUpdate; errors: null } | { fields: null; errors: TargetsErrors } {
  const errors: TargetsErrors = {};
  const whole = (key: keyof TargetsForm, min: number, max: number) => {
    const value = parseNumber(form[key]);
    if (value === null || !Number.isInteger(value) || value < min || value > max) {
      errors[key] = `Use a whole number from ${min} to ${max}`;
    }
    return value ?? 0;
  };
  const fields = {
    kcal: whole('kcal', 500, 10_000),
    protein_g: whole('protein', 0, 1000),
    carbs_g: whole('carbs', 0, 2000),
    fat_g: whole('fat', 0, 1000),
  };
  return Object.keys(errors).length > 0 ? { fields: null, errors } : { fields, errors: null };
}
