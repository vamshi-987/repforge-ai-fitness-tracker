import { elapsedMs, formatAgo, formatElapsed } from '../time';

describe('elapsed time', () => {
  it('is derived from the start time and never negative', () => {
    expect(elapsedMs(1_000, 61_000)).toBe(60_000);
    expect(elapsedMs(61_000, 1_000)).toBe(0);
  });

  it.each([
    [0, '00:00:00'],
    [999, '00:00:00'],
    [5 * 60_000 + 23_000, '00:05:23'],
    [3 * 3_600_000 + 7_000, '03:00:07'],
    [-5_000, '00:00:00'],
  ])('%p ms → %p', (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected);
  });

  it.each([
    [30_000, 'just now'],
    [5 * 60_000, '5 min ago'],
    [72 * 60_000, '1 h 12 min ago'],
    [120 * 60_000, '2 h ago'],
  ])('%p ms → %p', (ms, expected) => {
    expect(formatAgo(ms)).toBe(expected);
  });
});
