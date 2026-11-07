import type { Food, FoodLog, Meal, NutritionTargets, Per100g, Serving } from '@/api/types';
import { round1 } from '@/lib/macros';

export const MEALS: readonly Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};

// --- days -----------------------------------------------------------------------------------

/** The local calendar day of a moment, as YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Calendar arithmetic in UTC, so a daylight-saving change can't skip or repeat a day. */
export function shiftDay(day: string, days: number): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

export function isDayKey(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return shiftDay(text, 0) === text;
}

export function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today';
  if (day === shiftDay(today, -1)) return 'Yesterday';
  if (day === shiftDay(today, 1)) return 'Tomorrow';
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(year, month - 1, date).toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** The meal most people would be logging at this hour. */
export function mealAt(ms: number): Meal {
  const hour = new Date(ms).getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 22) return 'dinner';
  return 'snack';
}

// --- totals ---------------------------------------------------------------------------------

export interface Totals {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

export function totals(logs: FoodLog[]): Totals {
  const sum = (pick: (log: FoodLog) => number) =>
    round1(logs.reduce((total, log) => total + pick(log), 0));
  return {
    kcal: sum((l) => l.kcal),
    protein_g: sum((l) => l.protein_g),
    carbs_g: sum((l) => l.carbs_g),
    fat_g: sum((l) => l.fat_g),
    fiber_g: sum((l) => l.fiber_g ?? 0),
  };
}

export function byMeal(logs: FoodLog[]): Record<Meal, FoodLog[]> {
  return {
    breakfast: logs.filter((l) => l.meal === 'breakfast'),
    lunch: logs.filter((l) => l.meal === 'lunch'),
    dinner: logs.filter((l) => l.meal === 'dinner'),
    snack: logs.filter((l) => l.meal === 'snack'),
  };
}

/** The targets in force on `day`; before the first row, the first row (as the server does). */
export function targetsOn(rows: NutritionTargets[], day: string): NutritionTargets | null {
  const sorted = [...rows].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  return sorted.filter((t) => t.effective_from <= day).at(-1) ?? sorted[0] ?? null;
}

// --- foods ----------------------------------------------------------------------------------

export function per100g(food: Food): Per100g {
  return {
    kcal: food.kcal_100g,
    protein: food.protein_100g,
    carbs: food.carbs_100g,
    fat: food.fat_100g,
    fiber: food.fiber_100g,
  };
}

/** Grams and millilitres (taken as 1 g/ml), the food's servings, and any other unit in use. */
export function unitOptions(servings: Serving[], current?: Serving): Serving[] {
  const options = [{ label: 'g', grams: 1 }, { label: 'ml', grams: 1 }, ...servings];
  return current && !options.some((o) => o.label === current.label)
    ? [...options, current]
    : options;
}

export function defaultPortion(servings: Serving[]): { quantity: number; unit: string } {
  const first = servings[0];
  return first ? { quantity: 1, unit: first.label } : { quantity: 100, unit: 'g' };
}

export function foodMatches(food: Food, query: string): boolean {
  const name = `${food.name} ${food.brand ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => name.includes(word));
}

/** Local results first; the same food found online isn't listed twice. */
export function mergeFoods(local: Food[], remote: Food[]): Food[] {
  const seen = new Set(local.map((f) => f.id));
  return [...local, ...remote.filter((f) => !seen.has(f.id))];
}

export interface RecentFood {
  /** The newest log of this food: tapping it starts from that entry. */
  log: FoodLog;
  times: number;
}

/** Foods from logs (newest first), newest use first. Logs without a food are one-offs. */
export function recentFoods(logs: FoodLog[]): RecentFood[] {
  const seen = new Map<string, RecentFood>();
  for (const log of logs) {
    if (log.food_id === null) continue;
    const entry = seen.get(log.food_id);
    if (entry) entry.times += 1;
    else seen.set(log.food_id, { log, times: 1 });
  }
  return [...seen.values()];
}

export function frequentFoods(logs: FoodLog[]): RecentFood[] {
  return recentFoods(logs)
    .filter((f) => f.times > 1)
    .sort((a, b) => b.times - a.times);
}

export function formatAmount(value: number): string {
  return String(Math.round(value * 10) / 10);
}

// --- typed numbers --------------------------------------------------------------------------

/** A number from a text field (a decimal comma is fine), or null if it isn't one. */
export function parseNumber(text: string): number | null {
  const cleaned = text.trim().replace(',', '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return null;
  return Number(cleaned);
}
