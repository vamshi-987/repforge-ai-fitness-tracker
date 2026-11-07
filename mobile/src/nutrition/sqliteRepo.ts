import { and, asc, desc, eq, sql } from 'drizzle-orm';

import type { Food, FoodLog, SavedMeal } from '@/api/types';
import { db } from '@/db/client';
import { foodLogs, foods, nutritionTargets, savedMeals } from '@/db/schema';

import type { NutritionRepo } from './repo';
import { targetsOn } from './rules';

const iso = (ms: number) => new Date(ms).toISOString();

function toFood(r: typeof foods.$inferSelect): Food {
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    source: r.source,
    barcode: r.barcode,
    kcal_100g: r.kcal100g,
    protein_100g: r.protein100g,
    carbs_100g: r.carbs100g,
    fat_100g: r.fat100g,
    fiber_100g: r.fiber100g,
    servings: r.servings,
    is_custom: r.isCustom,
    version: r.version,
    updated_at: iso(r.updatedAt),
  };
}

function toLog(r: typeof foodLogs.$inferSelect): FoodLog {
  return {
    id: r.id,
    log_date: r.logDate,
    meal: r.meal,
    food_id: r.foodId,
    name: r.name,
    brand: r.brand,
    per_100g: r.per100g,
    quantity: r.quantity,
    unit: r.unit,
    grams: r.grams,
    kcal: r.kcal,
    protein_g: r.proteinG,
    carbs_g: r.carbsG,
    fat_g: r.fatG,
    fiber_g: r.fiberG,
    macros_overridden: r.macrosOverridden,
    kcal_overridden: r.kcalOverridden,
    source: r.source,
    photo_analysis_id: r.photoAnalysisId,
    version: r.version,
    created_at: iso(r.createdAt),
    updated_at: iso(r.updatedAt),
  };
}

function toMeal(r: typeof savedMeals.$inferSelect): SavedMeal {
  return {
    id: r.id,
    name: r.name,
    items: r.items,
    version: r.version,
    updated_at: iso(r.updatedAt),
  };
}

export const sqliteNutritionRepo: NutritionRepo = {
  async food(id) {
    const row = db.select().from(foods).where(eq(foods.id, id)).get();
    return row ? toFood(row) : null;
  },
  async foodByBarcode(barcode) {
    const row = db.select().from(foods).where(eq(foods.barcode, barcode)).get();
    return row ? toFood(row) : null;
  },
  async searchFoods(query, limit) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const haystack = sql`lower(${foods.name} || ' ' || coalesce(${foods.brand}, ''))`;
    return db
      .select()
      .from(foods)
      .where(and(...words.map((word) => sql`instr(${haystack}, ${word}) > 0`)))
      .orderBy(desc(foods.isCustom), asc(foods.name))
      .limit(limit)
      .all()
      .map(toFood);
  },
  async customFoods() {
    return db
      .select()
      .from(foods)
      .where(eq(foods.isCustom, true))
      .orderBy(asc(foods.name))
      .all()
      .map(toFood);
  },
  async putFood(food) {
    const values = {
      id: food.id,
      name: food.name,
      brand: food.brand,
      source: food.source,
      barcode: food.barcode,
      kcal100g: food.kcal_100g,
      protein100g: food.protein_100g,
      carbs100g: food.carbs_100g,
      fat100g: food.fat_100g,
      fiber100g: food.fiber_100g,
      servings: food.servings,
      isCustom: food.is_custom,
      version: food.version,
      updatedAt: Date.parse(food.updated_at),
    };
    db.insert(foods).values(values).onConflictDoUpdate({ target: foods.id, set: values }).run();
  },
  async removeFood(id) {
    db.delete(foods).where(eq(foods.id, id)).run();
  },

  async log(id) {
    const row = db.select().from(foodLogs).where(eq(foodLogs.id, id)).get();
    return row ? toLog(row) : null;
  },
  async logsOn(day) {
    return db
      .select()
      .from(foodLogs)
      .where(eq(foodLogs.logDate, day))
      .orderBy(asc(foodLogs.createdAt), asc(foodLogs.id))
      .all()
      .map(toLog);
  },
  async recentLogs(limit) {
    return db
      .select()
      .from(foodLogs)
      .orderBy(desc(foodLogs.createdAt), desc(foodLogs.id))
      .limit(limit)
      .all()
      .map(toLog);
  },
  async putLog(log) {
    const values = {
      id: log.id,
      logDate: log.log_date,
      meal: log.meal,
      foodId: log.food_id,
      name: log.name,
      brand: log.brand,
      per100g: log.per_100g,
      quantity: log.quantity,
      unit: log.unit,
      grams: log.grams,
      kcal: log.kcal,
      proteinG: log.protein_g,
      carbsG: log.carbs_g,
      fatG: log.fat_g,
      fiberG: log.fiber_g,
      macrosOverridden: log.macros_overridden,
      kcalOverridden: log.kcal_overridden,
      source: log.source,
      photoAnalysisId: log.photo_analysis_id,
      version: log.version,
      createdAt: Date.parse(log.created_at),
      updatedAt: Date.parse(log.updated_at),
    };
    db.insert(foodLogs)
      .values(values)
      .onConflictDoUpdate({ target: foodLogs.id, set: values })
      .run();
  },
  async removeLog(id) {
    db.delete(foodLogs).where(eq(foodLogs.id, id)).run();
  },

  async savedMeals() {
    return db.select().from(savedMeals).orderBy(asc(savedMeals.name)).all().map(toMeal);
  },
  async putSavedMeal(meal) {
    const values = {
      id: meal.id,
      name: meal.name,
      items: meal.items,
      version: meal.version,
      updatedAt: Date.parse(meal.updated_at),
    };
    db.insert(savedMeals)
      .values(values)
      .onConflictDoUpdate({ target: savedMeals.id, set: values })
      .run();
  },
  async removeSavedMeal(id) {
    db.delete(savedMeals).where(eq(savedMeals.id, id)).run();
  },

  async targetsOn(day) {
    const rows = db.select().from(nutritionTargets).all();
    return targetsOn(
      rows.map((r) => ({
        effective_from: r.effectiveFrom,
        kcal: r.kcal,
        protein_g: r.proteinG,
        carbs_g: r.carbsG,
        fat_g: r.fatG,
        reason: r.reason,
      })),
      day,
    );
  },
  async putTargets(targets) {
    const values = {
      effectiveFrom: targets.effective_from,
      kcal: targets.kcal,
      proteinG: targets.protein_g,
      carbsG: targets.carbs_g,
      fatG: targets.fat_g,
      reason: targets.reason,
    };
    db.insert(nutritionTargets)
      .values(values)
      .onConflictDoUpdate({ target: nutritionTargets.effectiveFrom, set: values })
      .run();
  },

  async clear() {
    db.delete(foods).run();
    db.delete(foodLogs).run();
    db.delete(savedMeals).run();
    db.delete(nutritionTargets).run();
  },
};
