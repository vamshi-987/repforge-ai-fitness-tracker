import type { Per100g } from '@/api/types';

import { kcalFromMacros, logAmounts, round1, scale } from '../macros';

const DAL: Per100g = { kcal: 145, protein: 8.6, carbs: 19.17, fat: 4.31, fiber: 7.5 };

describe('food log arithmetic', () => {
  it('computes calories as 4P + 4C + 9F', () => {
    expect(kcalFromMacros(10, 20, 5)).toBe(165);
  });

  it('scales per-100 g values to the grams eaten', () => {
    expect(scale(145, 200)).toBe(290);
  });

  it('rounds halves up to 0.1', () => {
    expect(round1(0.15)).toBe(0.2);
    expect(round1(2.25)).toBe(2.3);
    expect(round1(2.24)).toBe(2.2);
  });

  it('scales everything when nothing was edited', () => {
    expect(logAmounts(DAL, 150)).toEqual({
      kcal: 217.5,
      protein_g: 12.9,
      carbs_g: 28.8,
      fat_g: 6.5,
      fiber_g: 11.3,
      macros_overridden: false,
      kcal_overridden: false,
    });
  });

  it('keeps fiber unknown when the food has none', () => {
    expect(logAmounts({ ...DAL, fiber: null }, 100).fiber_g).toBeNull();
  });

  it('follows edited macros with the calories', () => {
    const edited = { protein_g: 20, carbs_g: 10, fat_g: 5, fiber_g: null };

    expect(logAmounts(DAL, 150, edited)).toMatchObject({
      kcal: 165,
      protein_g: 20,
      fiber_g: null,
      macros_overridden: true,
      kcal_overridden: false,
    });
  });

  it('keeps calories typed by hand, whatever the macros say', () => {
    const edited = { protein_g: 20, carbs_g: 10, fat_g: 5, fiber_g: 2 };

    expect(logAmounts(DAL, 150, edited, 300)).toMatchObject({
      kcal: 300,
      macros_overridden: true,
      kcal_overridden: true,
    });
    expect(logAmounts(DAL, 150, null, 0)).toMatchObject({ kcal: 0, kcal_overridden: true });
  });
});
