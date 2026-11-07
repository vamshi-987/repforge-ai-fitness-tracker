import { estimateOneRepMax, repTable, weightForReps } from '../oneRepMax';
import { BARS, describePlates, loadBar, PLATES, roundToLoadable } from '../plates';
import { warmupSets } from '../warmup';

describe('plate calculator', () => {
  it.each([
    [100, 20, [25, 15], 100],
    [102.5, 20, [25, 15, 1.25], 102.5],
    [62.5, 20, [20, 1.25], 62.5],
    [20, 20, [], 20],
    [15, 20, [], 20],
  ])('loads %s kg on a %s kg bar', (target, bar, perSide, total) => {
    expect(loadBar(target, bar, PLATES.kg)).toEqual({
      perSide,
      total,
      short: Math.max(0, target - total),
    });
  });

  it('loads lb plates for lb users', () => {
    expect(loadBar(225, 45, PLATES.lb).perSide).toEqual([45, 45]);
    expect(loadBar(185, 45, PLATES.lb).perSide).toEqual([45, 25]);
  });

  it('says how far off a target the plates can’t make', () => {
    expect(loadBar(101, 20, PLATES.kg)).toEqual({ perSide: [25, 15], total: 100, short: 1 });
    // Only 20s available.
    expect(loadBar(70, 20, [20]).short).toBe(10);
  });

  it('rounds to a loadable weight without float drift', () => {
    expect(roundToLoadable(41, 20, PLATES.kg)).toBe(40);
    expect(roundToLoadable(41.4, 20, PLATES.kg)).toBe(42.5);
    expect(roundToLoadable(10, 20, PLATES.kg)).toBe(20);
    expect(roundToLoadable(137, 45, PLATES.lb)).toBe(135);
  });

  it('groups plates for display', () => {
    expect(describePlates([20, 20, 2.5])).toBe('2 × 20, 1 × 2.5');
    expect(describePlates([])).toBe('');
    expect(BARS.kg[0]).toBe(20);
  });
});

describe('1RM calculator', () => {
  it('estimates with Epley and flags high reps', () => {
    expect(estimateOneRepMax(100, 1)).toEqual({ value: 100, rough: false });
    expect(estimateOneRepMax(100, 5)?.value).toBeCloseTo(116.67, 2);
    expect(estimateOneRepMax(60, 15)).toEqual({ value: 90, rough: true });
    expect(estimateOneRepMax(100, 0)).toBeNull();
    expect(estimateOneRepMax(100, 2.5)).toBeNull();
    expect(estimateOneRepMax(0, 5)).toBeNull();
  });

  it('is the inverse of the rep table', () => {
    expect(weightForReps(116.67, 5)).toBeCloseTo(100, 1);
    const table = repTable(100);
    expect(table[0]).toEqual({ reps: 1, weight: 100, percent: 100 });
    expect(table.find((r) => r.reps === 10)).toEqual({ reps: 10, weight: 75, percent: 75 });
  });
});

describe('warm-up calculator', () => {
  it('ramps from the bar in loadable steps', () => {
    expect(warmupSets(100, 20, PLATES.kg)).toEqual([
      { weight: 20, reps: 10, percent: null },
      { weight: 40, reps: 5, percent: 40 },
      { weight: 60, reps: 3, percent: 60 },
      { weight: 80, reps: 2, percent: 80 },
    ]);
  });

  it('skips steps that would repeat the bar or reach the working weight', () => {
    expect(warmupSets(30, 20, PLATES.kg).map((s) => s.weight)).toEqual([20, 25]);
    expect(warmupSets(20, 20, PLATES.kg)).toEqual([]);
    expect(warmupSets(225, 45, PLATES.lb).map((s) => s.weight)).toEqual([45, 90, 135, 180]);
  });
});
