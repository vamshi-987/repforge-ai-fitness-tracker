import type { Food, FoodLog } from '@/api/types';

export function makeFood(overrides: Partial<Food> = {}): Food {
  return {
    id: 'food-1',
    name: 'Dal',
    brand: null,
    source: 'usda',
    barcode: null,
    kcal_100g: 165,
    protein_100g: 10,
    carbs_100g: 20,
    fat_100g: 5,
    fiber_100g: null,
    servings: [],
    is_custom: false,
    version: 1,
    updated_at: '2026-11-01T06:00:00.000Z',
    ...overrides,
  };
}

export function makeLog(overrides: Partial<FoodLog> = {}): FoodLog {
  return {
    id: 'log-1',
    log_date: '2026-11-03',
    meal: 'lunch',
    food_id: 'food-1',
    name: 'Dal',
    brand: null,
    per_100g: { kcal: 165, protein: 10, carbs: 20, fat: 5, fiber: null },
    quantity: 200,
    unit: 'g',
    grams: 200,
    kcal: 330,
    protein_g: 20,
    carbs_g: 40,
    fat_g: 10,
    fiber_g: null,
    macros_overridden: false,
    kcal_overridden: false,
    source: 'search',
    photo_analysis_id: null,
    version: 1,
    created_at: '2026-11-03T07:00:00.000Z',
    updated_at: '2026-11-03T07:00:00.000Z',
    ...overrides,
  };
}
