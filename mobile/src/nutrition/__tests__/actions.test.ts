import { ApiError } from '@/api/client';
import type { OutboxItem, OutboxRepo } from '@/sync/outbox';
import { makeFood, makeLog } from '@/test/nutrition';

import {
  addLog,
  copyLogs,
  deleteCustomFood,
  deleteLog,
  deleteSavedMeal,
  findBarcode,
  logSavedMeal,
  saveCustomFood,
  saveMealTemplate,
  updateLog,
  type FoodFields,
  type LogInput,
} from '../actions';
import type { createMemoryNutritionRepo } from '../repo';

jest.mock('@/api/nutrition', () => ({ foodByBarcode: jest.fn(), searchFoods: jest.fn() }));

const api = jest.requireMock<{ foodByBarcode: jest.Mock }>('@/api/nutrition');
const repo = jest.requireMock<{
  sqliteNutritionRepo: ReturnType<typeof createMemoryNutritionRepo>;
}>('@/nutrition/sqliteRepo').sqliteNutritionRepo;
const outbox = jest.requireMock<{ sqliteOutbox: OutboxRepo & { items: OutboxItem[] } }>(
  '@/sync/sqliteOutbox',
).sqliteOutbox;

const NOW = Date.parse('2026-11-05T08:00:00.000Z');
const INPUT: LogInput = {
  log_date: '2026-11-05',
  meal: 'lunch',
  food_id: 'food-1',
  name: 'Dal',
  brand: null,
  per_100g: { kcal: 165, protein: 10, carbs: 20, fat: 5, fiber: null },
  quantity: 2,
  unit: '1 bowl',
  grams: 400,
  macros: null,
  kcal: null,
  source: 'search',
};
const FIELDS: FoodFields = {
  name: 'Mom’s dal',
  brand: null,
  barcode: null,
  kcal_100g: 120,
  protein_100g: 7,
  carbs_100g: 15,
  fat_100g: 3,
  fiber_100g: null,
  servings: [],
};

beforeEach(async () => {
  jest.clearAllMocks();
  await repo.clear();
  await outbox.clear();
});

describe('logs', () => {
  it('stores the amounts and queues the snapshot', async () => {
    const log = await addLog(INPUT, NOW);

    expect(log).toMatchObject({ kcal: 660, protein_g: 40, version: 0 });
    expect(await repo.logsOn('2026-11-05')).toEqual([log]);
    expect(outbox.items).toEqual([
      expect.objectContaining({
        entity: 'food_log',
        entityId: log.id,
        op: 'upsert',
        baseVersion: null,
        data: {
          log_date: '2026-11-05',
          meal: 'lunch',
          food_id: 'food-1',
          name: 'Dal',
          brand: null,
          per_100g: INPUT.per_100g,
          quantity: 2,
          unit: '1 bowl',
          grams: 400,
          macros: null,
          kcal: null,
          source: 'search',
          photo_analysis_id: null,
        },
      }),
    ]);
  });

  it('sends only what the user typed over the snapshot', async () => {
    const macros = { protein_g: 50, carbs_g: 10, fat_g: 5, fiber_g: null };

    const log = await addLog({ ...INPUT, macros, kcal: 400 }, NOW);

    expect(log).toMatchObject({ kcal: 400, macros_overridden: true, kcal_overridden: true });
    expect(outbox.items[0]?.data).toMatchObject({ macros, kcal: 400 });
  });

  it('changes a log from its own snapshot, against the server’s version', async () => {
    const log = makeLog({ version: 3 });
    await repo.putLog(log);

    const edit = { meal: 'dinner', quantity: 100, unit: 'g', grams: 100 } as const;
    const updated = await updateLog(log, { ...edit, macros: null, kcal: null }, NOW);

    expect(updated).toMatchObject({
      meal: 'dinner',
      kcal: 165,
      protein_g: 10,
      created_at: log.created_at,
      updated_at: new Date(NOW).toISOString(),
    });
    expect(outbox.items[0]).toMatchObject({ baseVersion: 3 });
  });

  it('deletes a log', async () => {
    await repo.putLog(makeLog());

    await deleteLog('log-1');

    expect(repo.logs).toEqual([]);
    expect(outbox.items).toEqual([
      expect.objectContaining({ entity: 'food_log', entityId: 'log-1', op: 'delete' }),
    ]);
  });

  it('copies logs to another day as new rows, in order, flags and all', async () => {
    const first = makeLog({ id: 'a', kcal: 999, kcal_overridden: true, version: 4 });
    const second = makeLog({ id: 'b' });

    await copyLogs([first, second], '2026-11-06', NOW);

    const copies = await repo.logsOn('2026-11-06');
    expect(copies.map((l) => [l.kcal, l.kcal_overridden, l.version])).toEqual([
      [999, true, 0],
      [330, false, 0],
    ]);
    expect(copies.map((l) => l.id)).not.toContain('a');
    expect(outbox.items[0]).toMatchObject({ baseVersion: null, data: { kcal: 999 } });
  });
});

describe('custom foods', () => {
  it('creates one and queues it', async () => {
    const food = await saveCustomFood(FIELDS, null, NOW);

    expect(food).toMatchObject({ source: 'custom', is_custom: true, version: 0 });
    expect(outbox.items).toEqual([
      expect.objectContaining({
        entity: 'food',
        entityId: food.id,
        baseVersion: null,
        data: FIELDS,
      }),
    ]);
  });

  it('never rewrites a past log when the food changes or goes', async () => {
    const food = await saveCustomFood(FIELDS, null, NOW);
    const log = await addLog(
      {
        ...INPUT,
        food_id: food.id,
        per_100g: { kcal: 120, protein: 7, carbs: 15, fat: 3, fiber: null },
      },
      NOW,
    );

    const edited = await saveCustomFood({ ...FIELDS, kcal_100g: 500 }, food, NOW);

    expect(edited.id).toBe(food.id);
    expect(await repo.log(log.id)).toEqual(log);
    await deleteCustomFood(food.id);
    expect(await repo.food(food.id)).toBeNull();
    expect(await repo.log(log.id)).toEqual(log);
  });
});

describe('saved meals', () => {
  it('keeps only entries with a food, and nothing when there are none', async () => {
    const meal = await saveMealTemplate(
      'Lunch',
      [makeLog({ food_id: null }), makeLog({ id: 'b', quantity: 1, unit: '1 bowl' })],
      NOW,
    );

    expect(meal?.items).toHaveLength(1);
    expect(outbox.items[0]).toMatchObject({
      entity: 'saved_meal',
      data: {
        name: 'Lunch',
        items: [{ food_id: 'food-1', quantity: 1, unit: '1 bowl', grams: 200 }],
      },
    });
    expect(await saveMealTemplate('None', [makeLog({ food_id: null })], NOW)).toBeNull();
  });

  it('logs a meal with the food’s current values, or the saved ones without it', async () => {
    const meal = await saveMealTemplate(
      'Lunch',
      [makeLog(), makeLog({ id: 'b', food_id: 'gone', name: 'Rice' })],
      NOW,
    );
    await repo.putFood(makeFood({ name: 'Dal tadka', kcal_100g: 200 }));

    await logSavedMeal(meal!, '2026-11-06', 'dinner', NOW);

    const logs = await repo.logsOn('2026-11-06');
    expect(logs.map((l) => [l.name, l.kcal, l.meal, l.source])).toEqual([
      ['Dal tadka', 400, 'dinner', 'recent'],
      ['Rice', 330, 'dinner', 'recent'],
    ]);
  });

  it('deletes a saved meal', async () => {
    const meal = await saveMealTemplate('Lunch', [makeLog()], NOW);

    await deleteSavedMeal(meal!.id);

    expect(await repo.savedMeals()).toEqual([]);
    expect(outbox.items.at(-1)).toMatchObject({ entity: 'saved_meal', op: 'delete' });
  });
});

describe('barcodes', () => {
  it('answers from the device first', async () => {
    await repo.putFood(makeFood({ barcode: '8901058851298' }));

    expect(await findBarcode('8901058851298')).toMatchObject({ kind: 'found' });
    expect(api.foodByBarcode).not.toHaveBeenCalled();
  });

  it('keeps a food found online for offline use', async () => {
    const food = makeFood({ barcode: '8901058851298' });
    api.foodByBarcode.mockResolvedValue(food);

    expect(await findBarcode('8901058851298')).toEqual({ kind: 'found', food });
    expect(await repo.food(food.id)).toEqual(food);
  });

  it.each([
    [new ApiError(404, 'not_found', 'Not found'), 'unknown'],
    [new ApiError(0, 'network_error', 'Offline'), 'offline'],
    [new ApiError(503, 'food_source_unavailable', 'Down'), 'unavailable'],
  ])('reports %s', async (error, kind) => {
    api.foodByBarcode.mockRejectedValue(error);

    expect(await findBarcode('12345678')).toEqual({ kind });
  });
});
