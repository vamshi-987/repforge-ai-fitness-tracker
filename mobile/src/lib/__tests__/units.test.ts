import {
  cmToFeetInches,
  displayWeight,
  feetInchesToCm,
  formatHeight,
  formatWeight,
  kgToLb,
  lbToKg,
  parseDecimal,
  roundTo,
  weightToKg,
} from '../units';

describe('roundTo', () => {
  it.each([
    [1.005, 2, 1.01],
    [168.25, 1, 168.3],
    [2.675, 2, 2.68],
    [-1.25, 1, -1.3],
    [80, 1, 80],
  ])('roundTo(%p, %p) = %p', (value, decimals, expected) => {
    expect(roundTo(value, decimals)).toBe(expected);
  });
});

describe('weight', () => {
  it('converts kg and lb exactly', () => {
    expect(kgToLb(100)).toBeCloseTo(220.462, 3);
    expect(lbToKg(220.462)).toBeCloseTo(100, 3);
  });

  it.each([
    [72.5, 'kg', 72.5],
    [72.57, 'lb', 160],
    [100, 'lb', 220.5],
  ] as const)('displays %p kg in %s as %p', (kg, unit, expected) => {
    expect(displayWeight(kg, unit)).toBe(expected);
  });

  it('round-trips user input through kg without drift', () => {
    for (const lb of [95, 135, 160, 185.5, 225, 315]) {
      expect(displayWeight(weightToKg(lb, 'lb'), 'lb')).toBe(lb);
    }
    for (const kg of [40, 62.5, 80.25]) {
      expect(weightToKg(kg, 'kg')).toBe(kg);
    }
  });

  it('formats without a trailing .0', () => {
    expect(formatWeight(80, 'kg')).toBe('80 kg');
    expect(formatWeight(72.5, 'kg')).toBe('72.5 kg');
    expect(formatWeight(72.57, 'lb')).toBe('160 lb');
  });
});

describe('height', () => {
  it.each([
    [178, { feet: 5, inches: 10 }],
    [179.9, { feet: 5, inches: 11 }],
    [182.8, { feet: 6, inches: 0 }], // 71.97 in rounds up and carries
    [152.4, { feet: 5, inches: 0 }],
  ])('%p cm → %p', (cm, expected) => {
    expect(cmToFeetInches(cm)).toEqual(expected);
  });

  it('converts feet and inches to cm at 0.1 precision', () => {
    expect(feetInchesToCm({ feet: 5, inches: 10 })).toBe(177.8);
    expect(feetInchesToCm({ feet: 6, inches: 0 })).toBe(182.9);
  });

  it('formats in either unit', () => {
    expect(formatHeight(177.8, 'cm')).toBe('178 cm');
    expect(formatHeight(177.8, 'in')).toBe('5′10″');
  });
});

describe('parseDecimal', () => {
  it.each([
    ['72.5', 72.5],
    ['72,5', 72.5],
    [' 80 ', 80],
    ['.5', 0.5],
    ['', null],
    ['abc', null],
    ['-5', null],
    ['1.2.3', null],
    ['1e3', null],
  ])('%p → %p', (text, expected) => {
    expect(parseDecimal(text)).toBe(expected);
  });
});
