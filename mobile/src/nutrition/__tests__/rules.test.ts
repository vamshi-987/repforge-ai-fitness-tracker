import type { NutritionTargets } from '@/api/types';
import { makeFood, makeLog } from '@/test/nutrition';

import { createMemoryNutritionRepo } from '../repo';
import {
  dayKey,
  dayLabel,
  defaultPortion,
  foodMatches,
  frequentFoods,
  isDayKey,
  mealAt,
  mergeFoods,
  parseNumber,
  recentFoods,
  shiftDay,
  targetsOn,
  totals,
  unitOptions,
} from '../rules';

function target(effective_from: string, kcal: number): NutritionTargets {
  return { effective_from, kcal, protein_g: 150, carbs_g: 200, fat_g: 60, reason: 'initial' };
}

describe('days', () => {
  it('names the local calendar day', () => {
    expect(dayKey(new Date(2026, 10, 5, 23, 30).getTime())).toBe('2026-11-05');
    expect(dayKey(new Date(2026, 0, 9, 0, 5).getTime())).toBe('2026-01-09');
  });

  it('moves across months, years and leap days', () => {
    expect(shiftDay('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftDay('2027-01-01', -1)).toBe('2026-12-31');
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('accepts only real dates', () => {
    expect(isDayKey('2026-11-05')).toBe(true);
    expect(isDayKey('2026-02-30')).toBe(false);
    expect(isDayKey('5 Nov')).toBe(false);
  });

  it('labels days near today', () => {
    expect(dayLabel('2026-11-05', '2026-11-05')).toBe('Today');
    expect(dayLabel('2026-11-04', '2026-11-05')).toBe('Yesterday');
    expect(dayLabel('2026-11-06', '2026-11-05')).toBe('Tomorrow');
    expect(dayLabel('2026-10-01', '2026-11-05')).toMatch(/Oct/);
  });

  it.each([
    [7, 'breakfast'],
    [13, 'lunch'],
    [19, 'dinner'],
    [23, 'snack'],
  ])('suggests the meal for %i:00', (hour, meal) => {
    expect(mealAt(new Date(2026, 10, 5, hour).getTime())).toBe(meal);
  });
});

describe('totals', () => {
  it('adds a day up, counting unknown fiber as none', () => {
    const logs = [
      makeLog({ kcal: 100.1, protein_g: 0.1, fiber_g: 2 }),
      makeLog({ id: 'b', kcal: 200.2, protein_g: 0.2, fiber_g: null }),
    ];

    expect(totals(logs)).toEqual({
      kcal: 300.3,
      protein_g: 0.3,
      carbs_g: 80,
      fat_g: 20,
      fiber_g: 2,
    });
    expect(totals([])).toEqual({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });
  });
});

describe('targets', () => {
  const rows = [target('2026-11-02', 2500), target('2026-10-01', 2200)];

  it('finds the row in force', () => {
    expect(targetsOn(rows, '2026-11-05')?.kcal).toBe(2500);
    expect(targetsOn(rows, '2026-10-15')?.kcal).toBe(2200);
  });

  it('uses the first row before it starts, and nothing without rows', () => {
    expect(targetsOn(rows, '2026-01-01')?.kcal).toBe(2200);
    expect(targetsOn([], '2026-01-01')).toBeNull();
  });
});

describe('foods', () => {
  it('offers grams, millilitres, servings and the unit already in use', () => {
    const roti = { label: '1 roti', grams: 40 };

    expect(unitOptions([roti]).map((u) => u.label)).toEqual(['g', 'ml', '1 roti']);
    expect(unitOptions([roti], { label: 'bowl', grams: 200 }).at(-1)?.label).toBe('bowl');
    expect(unitOptions([roti], roti)).toHaveLength(3);
  });

  it('starts from a serving when the food has one', () => {
    expect(defaultPortion([{ label: '1 roti', grams: 40 }])).toEqual({
      quantity: 1,
      unit: '1 roti',
    });
    expect(defaultPortion([])).toEqual({ quantity: 100, unit: 'g' });
  });

  it('matches every word against the name and brand', () => {
    const food = makeFood({ name: 'Greek Yogurt', brand: 'Epigamia' });

    expect(foodMatches(food, 'yogurt epi')).toBe(true);
    expect(foodMatches(food, 'yogurt plain')).toBe(false);
  });

  it('lists a food found both ways once, the device’s copy first', () => {
    const mine = makeFood({ id: 'a', name: 'Mine' });
    const merged = mergeFoods(
      [mine],
      [makeFood({ id: 'a', name: 'Server' }), makeFood({ id: 'b' })],
    );

    expect(merged.map((f) => f.id)).toEqual(['a', 'b']);
    expect(merged[0]?.name).toBe('Mine');
  });

  it('ranks foods by last use and by how often, skipping one-off entries', () => {
    const logs = [
      makeLog({ id: '1', food_id: 'rice' }),
      makeLog({ id: '2', food_id: 'dal' }),
      makeLog({ id: '3', food_id: 'dal' }),
      makeLog({ id: '4', food_id: null }),
      makeLog({ id: '5', food_id: 'dal' }),
      makeLog({ id: '6', food_id: 'rice' }),
      makeLog({ id: '7', food_id: 'egg' }),
    ];

    expect(recentFoods(logs).map((f) => [f.log.id, f.times])).toEqual([
      ['1', 2],
      ['2', 3],
      ['7', 1],
    ]);
    expect(frequentFoods(logs).map((f) => f.log.food_id)).toEqual(['dal', 'rice']);
  });
});

describe('typed numbers', () => {
  it.each([
    ['12', 12],
    [' 12.5 ', 12.5],
    ['12,5', 12.5],
    ['.5', 0.5],
    ['12.', 12],
  ])('reads %j', (text, value) => {
    expect(parseNumber(text)).toBe(value);
  });

  it.each(['', 'abc', '-1', '1.2.3', '.'])('refuses %j', (text) => {
    expect(parseNumber(text)).toBeNull();
  });
});

describe('the memory repo', () => {
  it('orders a day oldest first and recent logs newest first', async () => {
    const repo = createMemoryNutritionRepo();
    await repo.putLog(makeLog({ id: 'late', created_at: '2026-11-03T09:00:00.000Z' }));
    await repo.putLog(makeLog({ id: 'early', created_at: '2026-11-03T07:00:00.000Z' }));
    await repo.putLog(makeLog({ id: 'other', log_date: '2026-11-04' }));

    expect((await repo.logsOn('2026-11-03')).map((l) => l.id)).toEqual(['early', 'late']);
    expect((await repo.recentLogs(1)).map((l) => l.id)).toEqual(['late']);
  });

  it('puts custom foods first in a search', async () => {
    const repo = createMemoryNutritionRepo();
    await repo.putFood(makeFood({ id: 'a', name: 'A dal' }));
    await repo.putFood(makeFood({ id: 'b', name: 'B dal', is_custom: true }));

    expect((await repo.searchFoods('dal', 10)).map((f) => f.id)).toEqual(['b', 'a']);
    expect((await repo.customFoods()).map((f) => f.id)).toEqual(['b']);
  });
});
