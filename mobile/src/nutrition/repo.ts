import type { Food, FoodLog, NutritionTargets, SavedMeal } from '@/api/types';

import { foodMatches, targetsOn } from './rules';

/** The device's foods, logs, saved meals and last known targets. SQLite in the app. */
export interface NutritionRepo {
  food(id: string): Promise<Food | null>;
  foodByBarcode(barcode: string): Promise<Food | null>;
  /** Names containing every word: custom foods first, then by name. */
  searchFoods(query: string, limit: number): Promise<Food[]>;
  customFoods(): Promise<Food[]>;
  putFood(food: Food): Promise<void>;
  removeFood(id: string): Promise<void>;

  log(id: string): Promise<FoodLog | null>;
  /** That day's logs, oldest first. */
  logsOn(day: string): Promise<FoodLog[]>;
  /** The newest logs, newest first. */
  recentLogs(limit: number): Promise<FoodLog[]>;
  putLog(log: FoodLog): Promise<void>;
  removeLog(id: string): Promise<void>;

  savedMeals(): Promise<SavedMeal[]>;
  putSavedMeal(meal: SavedMeal): Promise<void>;
  removeSavedMeal(id: string): Promise<void>;

  targetsOn(day: string): Promise<NutritionTargets | null>;
  putTargets(targets: NutritionTargets): Promise<void>;

  clear(): Promise<void>;
}

function upsert<Row>(rows: Row[], row: Row, same: (a: Row) => boolean): void {
  const index = rows.findIndex(same);
  if (index >= 0) rows.splice(index, 1, row);
  else rows.push(row);
}

function drop<Row extends { id: string }>(rows: Row[], id: string): void {
  const index = rows.findIndex((r) => r.id === id);
  if (index >= 0) rows.splice(index, 1);
}

const oldestFirst = (a: FoodLog, b: FoodLog) =>
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

export function createMemoryNutritionRepo(): NutritionRepo & {
  foods: Food[];
  logs: FoodLog[];
  meals: SavedMeal[];
  targets: NutritionTargets[];
} {
  const foods: Food[] = [];
  const logs: FoodLog[] = [];
  const meals: SavedMeal[] = [];
  const targets: NutritionTargets[] = [];
  return {
    foods,
    logs,
    meals,
    targets,
    async food(id) {
      return foods.find((f) => f.id === id) ?? null;
    },
    async foodByBarcode(barcode) {
      return foods.find((f) => f.barcode === barcode) ?? null;
    },
    async searchFoods(query, limit) {
      return foods
        .filter((f) => foodMatches(f, query))
        .sort((a, b) => Number(b.is_custom) - Number(a.is_custom) || a.name.localeCompare(b.name))
        .slice(0, limit);
    },
    async customFoods() {
      return foods.filter((f) => f.is_custom).sort((a, b) => a.name.localeCompare(b.name));
    },
    async putFood(food) {
      upsert(foods, food, (f) => f.id === food.id);
    },
    async removeFood(id) {
      drop(foods, id);
    },
    async log(id) {
      return logs.find((l) => l.id === id) ?? null;
    },
    async logsOn(day) {
      return logs.filter((l) => l.log_date === day).sort(oldestFirst);
    },
    async recentLogs(limit) {
      return [...logs].sort(oldestFirst).reverse().slice(0, limit);
    },
    async putLog(log) {
      upsert(logs, log, (l) => l.id === log.id);
    },
    async removeLog(id) {
      drop(logs, id);
    },
    async savedMeals() {
      return [...meals].sort((a, b) => a.name.localeCompare(b.name));
    },
    async putSavedMeal(meal) {
      upsert(meals, meal, (m) => m.id === meal.id);
    },
    async removeSavedMeal(id) {
      drop(meals, id);
    },
    async targetsOn(day) {
      return targetsOn(targets, day);
    },
    async putTargets(row) {
      upsert(targets, row, (t) => t.effective_from === row.effective_from);
    },
    async clear() {
      for (const rows of [foods, logs, meals, targets]) rows.splice(0, rows.length);
    },
  };
}
