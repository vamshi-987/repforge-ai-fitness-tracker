import { epley, isLowAccuracy } from '../e1rm';

describe('epley', () => {
  it.each([
    [100, 1, 103.33],
    [100, 5, 116.67],
    [60, 10, 80],
    [80, 30, 160],
  ])('%p kg × %p → %p', (weight, reps, expected) => {
    expect(epley(weight, reps)).toBeCloseTo(expected, 2);
  });

  it('has no estimate without weight or reps', () => {
    expect(epley(0, 5)).toBeNull();
    expect(epley(100, 0)).toBeNull();
  });

  it('flags more than 12 reps as low accuracy', () => {
    expect(isLowAccuracy(12)).toBe(false);
    expect(isLowAccuracy(13)).toBe(true);
  });
});
