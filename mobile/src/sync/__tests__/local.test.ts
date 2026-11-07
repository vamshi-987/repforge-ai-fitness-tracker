import type { BodyMeasurement, BodyWeight } from '@/api/types';
import { createMemoryBodyRepo } from '@/body/repo';
import { createMemoryRepo } from '@/exercises/repo';
import { createMemoryNutritionRepo } from '@/nutrition/repo';
import { createMemoryRoutineRepo } from '@/routines/repo';
import { makeFood, makeLog } from '@/test/nutrition';
import { createMemoryWaterRepo } from '@/water/repo';
import { createMemoryHistoryRepo } from '@/workout/history';

import { foodLogChange, measurementChange, savedMealChange, weightChange } from '../changes';
import { createLocalStore } from '../local';

const WEIGHT: BodyWeight = {
  id: 'w',
  measured_at: '2026-10-30T06:00:00.000Z',
  weight_kg: 80.2,
  source: 'manual',
  version: 3,
  created_at: '',
  updated_at: '',
};
const WAIST: BodyMeasurement = {
  id: 'm',
  measured_at: '2026-10-30T06:00:00.000Z',
  kind: 'waist',
  value: 82,
  version: 0,
  created_at: '',
  updated_at: '',
};

describe('body sync', () => {
  it('queues weigh-ins and measurements as their POST bodies', () => {
    expect(weightChange(WEIGHT)).toEqual({
      entity: 'body_weight',
      entityId: 'w',
      op: 'upsert',
      baseVersion: 3,
      data: { measured_at: WEIGHT.measured_at, weight_kg: 80.2, source: 'manual' },
    });
    expect(measurementChange(WAIST)).toMatchObject({
      entity: 'body_measurement',
      baseVersion: null,
      data: { measured_at: WAIST.measured_at, kind: 'waist', value: 82 },
    });
  });

  it('writes pulled body rows to the body repo', async () => {
    const body = createMemoryBodyRepo();
    const local = createLocalStore({
      library: createMemoryRepo(),
      routines: createMemoryRoutineRepo(),
      history: createMemoryHistoryRepo(),
      body,
      water: createMemoryWaterRepo(),
      nutrition: createMemoryNutritionRepo(),
    });

    await local.apply('body_weight', 'w', WEIGHT);
    await local.apply('body_measurement', 'm', WAIST);
    expect(await body.weights()).toEqual([WEIGHT]);
    expect(await body.measurements()).toEqual([WAIST]);

    await local.apply('body_weight', 'w', null);
    await local.apply('body_measurement', 'm', null);
    expect(await body.weights()).toEqual([]);
    expect(await body.measurements()).toEqual([]);
  });
});

describe('nutrition sync', () => {
  it('sends a plain log without overrides, and an edited one with them', () => {
    expect(foodLogChange(makeLog()).data).toMatchObject({ macros: null, kcal: null });
    expect(
      foodLogChange(makeLog({ macros_overridden: true, kcal_overridden: true, kcal: 500 })).data,
    ).toMatchObject({
      macros: { protein_g: 20, carbs_g: 40, fat_g: 10, fiber_g: null },
      kcal: 500,
    });
  });

  it('sends a saved meal without the display fields of its items', () => {
    const item = {
      food_id: 'f',
      name: 'Dal',
      quantity: 1,
      unit: 'g',
      grams: 100,
      per_100g: makeLog().per_100g,
    };
    const change = savedMealChange({
      id: 'm',
      name: 'Lunch',
      items: [item],
      version: 2,
      updated_at: '',
    });

    expect(change).toMatchObject({ baseVersion: 2 });
    expect(change.data).toEqual({
      name: 'Lunch',
      items: [{ food_id: 'f', quantity: 1, unit: 'g', grams: 100 }],
    });
  });

  it('writes pulled nutrition rows to the nutrition repo', async () => {
    const nutrition = createMemoryNutritionRepo();
    const local = createLocalStore({
      library: createMemoryRepo(),
      routines: createMemoryRoutineRepo(),
      history: createMemoryHistoryRepo(),
      body: createMemoryBodyRepo(),
      water: createMemoryWaterRepo(),
      nutrition,
    });
    const meal = { id: 'm', name: 'Lunch', items: [], version: 1, updated_at: '' };

    await local.apply('food', 'food-1', makeFood());
    await local.apply('food_log', 'log-1', makeLog());
    await local.apply('saved_meal', 'm', meal);
    expect(nutrition.foods).toHaveLength(1);
    expect(nutrition.logs).toHaveLength(1);
    expect(nutrition.meals).toHaveLength(1);

    await local.apply('food', 'food-1', null);
    await local.apply('food_log', 'log-1', null);
    await local.apply('saved_meal', 'm', null);
    expect(nutrition.foods).toEqual([]);
    expect(nutrition.logs).toEqual([]);
    expect(nutrition.meals).toEqual([]);
  });
});
