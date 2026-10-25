import { formatRest, stepValue } from '../format';

describe('formatRest', () => {
  it.each([
    [0, 'Off'],
    [45, '0:45'],
    [90, '1:30'],
    [600, '10:00'],
  ])('%p s → %p', (seconds, expected) => {
    expect(formatRest(seconds)).toBe(expected);
  });
});

describe('stepValue', () => {
  it('steps, snaps and clamps', () => {
    expect(stepValue(90, 15, 0, 900, 15)).toBe(105);
    expect(stepValue(100, 15, 0, 900, 15)).toBe(120);
    expect(stepValue(0, -15, 0, 900, 15)).toBe(0);
    expect(stepValue(900, 15, 0, 900, 15)).toBe(900);
  });
});
