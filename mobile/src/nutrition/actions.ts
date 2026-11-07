import * as nutritionApi from '@/api/nutrition';
import { ApiError } from '@/api/client';
import type { Food, FoodLog, LogSource, Meal, Per100g, SavedMeal, Serving } from '@/api/types';
import { newId } from '@/lib/ids';
import { logAmounts, type MacroOverride } from '@/lib/macros';
import { deletion, foodChange, foodLogChange, savedMealChange } from '@/sync/changes';
import { queueChange } from '@/sync/queue';

import { per100g } from './rules';
import { nutritionRepo } from './store';

// Logged on the device first and queued for the server, so everything here works offline.

const iso = (ms: number) => new Date(ms).toISOString();

export interface FoodFields {
  name: string;
  brand: string | null;
  barcode: string | null;
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  fiber_100g: number | null;
  servings: Serving[];
}

/** Past logs keep their snapshots: nothing here touches them. */
export async function saveCustomFood(
  fields: FoodFields,
  existing: Food | null = null,
  now = Date.now(),
): Promise<Food> {
  const food: Food = {
    id: existing?.id ?? newId(),
    source: 'custom',
    is_custom: true,
    version: existing?.version ?? 0,
    updated_at: iso(now),
    ...fields,
  };
  await nutritionRepo.putFood(food);
  await queueChange(foodChange(food));
  return food;
}

export async function deleteCustomFood(id: string): Promise<void> {
  await nutritionRepo.removeFood(id);
  await queueChange(deletion('food', id));
}

/** Keep a food found online on the device, so its entry screen and later logs work offline. */
export async function rememberFood(food: Food): Promise<void> {
  await nutritionRepo.putFood(food);
}

export type BarcodeResult =
  | { kind: 'found'; food: Food }
  | { kind: 'unknown' }
  | { kind: 'offline' }
  | { kind: 'unavailable' };

export async function findBarcode(code: string): Promise<BarcodeResult> {
  const stored = await nutritionRepo.foodByBarcode(code);
  if (stored) return { kind: 'found', food: stored };
  try {
    const food = await nutritionApi.foodByBarcode(code);
    await rememberFood(food);
    return { kind: 'found', food };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { kind: 'unknown' };
    if (error instanceof ApiError && error.status === 0) return { kind: 'offline' };
    return { kind: 'unavailable' };
  }
}

export interface LogInput {
  log_date: string;
  meal: Meal;
  food_id: string | null;
  name: string;
  brand: string | null;
  per_100g: Per100g;
  quantity: number;
  unit: string;
  grams: number;
  macros: MacroOverride | null;
  kcal: number | null;
  source: LogSource;
  photo_analysis_id?: string | null;
}

async function store(log: FoodLog): Promise<FoodLog> {
  await nutritionRepo.putLog(log);
  await queueChange(foodLogChange(log));
  return log;
}

export function addLog(input: LogInput, now = Date.now()): Promise<FoodLog> {
  const { macros, kcal, photo_analysis_id = null, ...fields } = input;
  const at = iso(now);
  return store({
    ...fields,
    ...logAmounts(input.per_100g, input.grams, macros, kcal),
    photo_analysis_id,
    id: newId(),
    version: 0,
    created_at: at,
    updated_at: at,
  });
}

export interface LogEdit {
  meal: Meal;
  quantity: number;
  unit: string;
  grams: number;
  macros: MacroOverride | null;
  kcal: number | null;
}

export function updateLog(log: FoodLog, edit: LogEdit, now = Date.now()): Promise<FoodLog> {
  const { macros, kcal, ...fields } = edit;
  return store({
    ...log,
    ...fields,
    ...logAmounts(log.per_100g, edit.grams, macros, kcal),
    updated_at: iso(now),
  });
}

export async function deleteLog(id: string): Promise<void> {
  await nutritionRepo.removeLog(id);
  await queueChange(deletion('food_log', id));
}

/** New logs on `toDay` with the same snapshots and amounts. Their order is kept. */
export async function copyLogs(logs: FoodLog[], toDay: string, now = Date.now()): Promise<void> {
  for (const [index, log] of logs.entries()) {
    const at = iso(now + index);
    await store({
      ...log,
      id: newId(),
      log_date: toDay,
      photo_analysis_id: null,
      version: 0,
      created_at: at,
      updated_at: at,
    });
  }
}

/** A template from logs that came from a food; one-off entries have nothing to point at. */
export async function saveMealTemplate(
  name: string,
  logs: FoodLog[],
  now = Date.now(),
): Promise<SavedMeal | null> {
  const items = logs.flatMap((log) =>
    log.food_id === null
      ? []
      : [
          {
            food_id: log.food_id,
            name: log.name,
            quantity: log.quantity,
            unit: log.unit,
            grams: log.grams,
            per_100g: log.per_100g,
          },
        ],
  );
  if (items.length === 0) return null;
  const meal: SavedMeal = {
    id: newId(),
    name,
    items,
    version: 0,
    updated_at: iso(now),
  };
  await nutritionRepo.putSavedMeal(meal);
  await queueChange(savedMealChange(meal));
  return meal;
}

/** One log per item, from the foods' current values when the device has them. */
export async function logSavedMeal(
  meal: SavedMeal,
  day: string,
  target: Meal,
  now = Date.now(),
): Promise<void> {
  for (const [index, item] of meal.items.entries()) {
    const food = await nutritionRepo.food(item.food_id);
    await addLog(
      {
        log_date: day,
        meal: target,
        food_id: item.food_id,
        name: food?.name ?? item.name,
        brand: food?.brand ?? null,
        per_100g: food ? per100g(food) : item.per_100g,
        quantity: item.quantity,
        unit: item.unit,
        grams: item.grams,
        macros: null,
        kcal: null,
        source: 'recent',
      },
      now + index,
    );
  }
}

export async function deleteSavedMeal(id: string): Promise<void> {
  await nutritionRepo.removeSavedMeal(id);
  await queueChange(deletion('saved_meal', id));
}
