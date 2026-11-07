import type { Per100g, Serving } from '@/api/types';
import { makeLog } from '@/test/nutrition';

import {
  formFromLog,
  readCustomFood,
  readEntry,
  readTargets,
  withMacro,
  type CustomFoodForm,
  type EntryForm,
} from '../entry';
import { unitOptions } from '../rules';

const PER_100G: Per100g = { kcal: 165, protein: 10, carbs: 20, fat: 5, fiber: 4 };
const UNITS: Serving[] = unitOptions([{ label: '1 bowl', grams: 200 }]);
const FORM: EntryForm = { quantity: '100', unit: 'g', macros: null, kcal: null };

describe('a log entry', () => {
  it('scales the food to the amount', () => {
    const entry = readEntry({ ...FORM, quantity: '1.5', unit: '1 bowl' }, UNITS, PER_100G);

    expect(entry).toMatchObject({ quantity: 1.5, grams: 300, error: null });
    expect(entry.amounts).toMatchObject({ kcal: 495, protein_g: 30, fiber_g: 12 });
  });

  it('recomputes calories when a macro changes', () => {
    const before = readEntry(FORM, UNITS, PER_100G);
    const form = withMacro(FORM, before.amounts, 'protein', '20');

    const after = readEntry(form, UNITS, PER_100G);

    // 4 × 20 + 4 × 20 + 9 × 5.
    expect(after.amounts).toMatchObject({ kcal: 205, protein_g: 20, macros_overridden: true });
    expect(after.macros).toEqual({ protein_g: 20, carbs_g: 20, fat_g: 5, fiber_g: 4 });
    expect(after.kcal).toBeNull();
  });

  it('keeps typed calories, flagged manual', () => {
    const entry = readEntry({ ...FORM, kcal: '250' }, UNITS, PER_100G);

    expect(entry.amounts).toMatchObject({ kcal: 250, kcal_overridden: true, protein_g: 10 });
  });

  it('treats emptied calories as not typed', () => {
    expect(readEntry({ ...FORM, kcal: ' ' }, UNITS, PER_100G).amounts).toMatchObject({
      kcal: 165,
      kcal_overridden: false,
    });
  });

  it('reads an emptied macro as zero, and emptied fiber as unknown', () => {
    const macros = { protein: '10', carbs: '20', fat: '', fiber: ' ' };

    expect(readEntry({ ...FORM, macros }, UNITS, PER_100G).macros).toEqual({
      protein_g: 10,
      carbs_g: 20,
      fat_g: 0,
      fiber_g: null,
    });
  });

  it.each([
    [{ quantity: '' }, 'Enter an amount'],
    [{ quantity: '0' }, 'Enter an amount'],
    [{ quantity: 'x' }, 'Enter an amount'],
    [{ quantity: '20001' }, 'That amount is too large'],
    [{ quantity: '101', unit: '1 bowl' }, 'That amount is too large'],
    [{ kcal: 'lots' }, 'Check the calories'],
    [{ kcal: '50001' }, 'Check the calories'],
    [
      { macros: { protein: '6000', carbs: '0', fat: '0', fiber: '' } },
      'Macros must be numbers up to 5000 g',
    ],
    [
      { macros: { protein: 'x', carbs: '0', fat: '0', fiber: '' } },
      'Macros must be numbers up to 5000 g',
    ],
  ])('refuses %j', (change, error) => {
    expect(readEntry({ ...FORM, ...change }, UNITS, PER_100G).error).toBe(error);
  });

  it('reopens an edited log with what was typed', () => {
    expect(formFromLog(makeLog())).toEqual({
      quantity: '200',
      unit: 'g',
      macros: null,
      kcal: null,
    });
    const edited = makeLog({
      macros_overridden: true,
      kcal_overridden: true,
      protein_g: 25.5,
      kcal: 400,
    });

    expect(formFromLog(edited)).toMatchObject({
      macros: { protein: '25.5', carbs: '40', fat: '10', fiber: '' },
      kcal: '400',
    });
  });
});

describe('a custom food', () => {
  const FOOD: CustomFoodForm = {
    name: '  Mom’s   dal ',
    brand: '',
    barcode: '',
    kcal: '120',
    protein: '7',
    carbs: '15',
    fat: '3',
    fiber: '',
    servings: [
      { label: ' 1 katori ', grams: '150' },
      { label: '', grams: '' },
    ],
  };

  it('tidies the form into a food', () => {
    expect(readCustomFood(FOOD).fields).toEqual({
      name: 'Mom’s dal',
      brand: null,
      barcode: null,
      kcal_100g: 120,
      protein_100g: 7,
      carbs_100g: 15,
      fat_100g: 3,
      fiber_100g: null,
      servings: [{ label: '1 katori', grams: 150 }],
    });
  });

  it('points at each field that is wrong', () => {
    const { errors } = readCustomFood({
      ...FOOD,
      name: ' ',
      barcode: '12',
      kcal: '901',
      protein: '',
      fiber: '101',
      servings: [{ label: 'x', grams: '' }],
    });

    expect(errors).toEqual({
      name: 'Give it a name',
      barcode: 'Use 8–14 digits',
      kcal: 'Use 0–900',
      protein: 'Use 0–100',
      fiber: 'Use 0–100',
      servings: 'Each serving needs a name and 1–5000 g',
    });
  });
});

describe('readTargets', () => {
  const form = { kcal: '2400', protein: '180', carbs: '250', fat: '70' };

  it('reads whole numbers', () => {
    expect(readTargets(form).fields).toEqual({
      kcal: 2400,
      protein_g: 180,
      carbs_g: 250,
      fat_g: 70,
    });
  });

  it('allows a macro of zero', () => {
    expect(readTargets({ ...form, carbs: '0' }).errors).toBeNull();
  });

  it('names each field outside the server’s limits', () => {
    const { errors } = readTargets({ kcal: '499', protein: '', carbs: '2001', fat: '70.5' });
    expect(errors).toEqual({
      kcal: 'Use a whole number from 500 to 10000',
      protein: 'Use a whole number from 0 to 1000',
      carbs: 'Use a whole number from 0 to 2000',
      fat: 'Use a whole number from 0 to 1000',
    });
  });
});
