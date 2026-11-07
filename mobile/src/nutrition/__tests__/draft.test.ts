import type { DraftItem, FoodDraft } from '@/api/types';
import type { OutboxItem, OutboxRepo } from '@/sync/outbox';

import { confirmDraft, draftError, draftKcal, isUnsure, readRow, rowsFromDraft } from '../draft';
import type { createMemoryNutritionRepo } from '../repo';

const repo = jest.requireMock<{
  sqliteNutritionRepo: ReturnType<typeof createMemoryNutritionRepo>;
}>('@/nutrition/sqliteRepo').sqliteNutritionRepo;
const outbox = jest.requireMock<{ sqliteOutbox: OutboxRepo & { items: OutboxItem[] } }>(
  '@/sync/sqliteOutbox',
).sqliteOutbox;

const BIRYANI: DraftItem = {
  name: 'Chicken biryani',
  food_id: 'food-1',
  grams: 350,
  per_100g: { kcal: 200, protein: 10, carbs: 25, fat: 6, fiber: 1 },
  kcal: 700,
  protein_g: 35,
  carbs_g: 87.5,
  fat_g: 21,
  fiber_g: 3.5,
  confidence: 0.7,
};
const RAITA: DraftItem = {
  name: 'Raita',
  food_id: null,
  grams: 100,
  per_100g: { kcal: 60, protein: 3, carbs: 5, fat: 3, fiber: null },
  kcal: 60,
  protein_g: 3,
  carbs_g: 5,
  fat_g: 3,
  fiber_g: null,
  confidence: 0.4,
};
const DRAFT: FoodDraft = { items: [BIRYANI, RAITA], notes: '' };
const TARGET = { date: '2026-11-05', meal: 'lunch', source: 'photo', analysisId: 'a1' } as const;

beforeEach(async () => {
  await repo.clear();
  await outbox.clear();
});

describe('a food draft', () => {
  it('starts from the draft’s amounts and scales with the grams', () => {
    const [row] = rowsFromDraft(DRAFT);
    if (!row) throw new Error('no row');

    expect(readRow(row).amounts).toMatchObject({ kcal: 700, protein_g: 35, fiber_g: 3.5 });
    const smaller = { ...row, form: { ...row.form, quantity: '175' } };
    expect(readRow(smaller).amounts).toMatchObject({ kcal: 350, protein_g: 17.5 });
  });

  it('adds up, and flags items the model wasn’t sure of', () => {
    const rows = rowsFromDraft(DRAFT);

    expect(draftKcal(rows)).toBe(760);
    expect(rows.map(isUnsure)).toEqual([false, true]);
  });

  it('won’t confirm a nameless item or an impossible amount', () => {
    const [first, second] = rowsFromDraft(DRAFT);
    if (!first || !second) throw new Error('no rows');

    expect(draftError([first, second])).toBeNull();
    expect(draftError([{ ...first, name: ' ' }])).toBe('Every item needs a name');
    expect(draftError([{ ...first, form: { ...first.form, quantity: '' } }])).toBe(
      'Chicken biryani: Enter an amount',
    );
  });

  it('logs each item against its draft, keeping edits and order', async () => {
    const [first, second] = rowsFromDraft(DRAFT);
    if (!first || !second) throw new Error('no rows');
    const edited = {
      ...second,
      form: {
        ...second.form,
        macros: { protein: '10', carbs: '5', fat: '3', fiber: '' },
      },
    };

    await confirmDraft([first, edited], TARGET, 1_000);

    const logs = await repo.logsOn('2026-11-05');
    expect(logs.map((l) => [l.name, l.food_id, l.kcal, l.macros_overridden])).toEqual([
      ['Chicken biryani', 'food-1', 700, false],
      ['Raita', null, 87, true],
    ]);
    expect(logs[0]).toMatchObject({ source: 'photo', photo_analysis_id: 'a1', unit: 'g' });
    expect(outbox.items[0]?.data).toMatchObject({ photo_analysis_id: 'a1', source: 'photo' });
  });
});
