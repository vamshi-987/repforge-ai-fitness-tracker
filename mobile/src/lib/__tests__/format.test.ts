import { formatDuration, formatRest, parseDuration, stepValue } from '../format';

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

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [45, '0:45'],
    [90, '1:30'],
    [3723, '1:02:03'],
    [-5, '0:00'],
  ])('%p s → %p', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe('parseDuration', () => {
  it.each([
    ['90', 90],
    ['1:30', 90],
    [' 0:05 ', 5],
    ['1:02:03', 3723],
    ['1:60', null],
    ['1:2:3:4', null],
    ['abc', null],
    ['', null],
    ['1:', null],
  ])('%p → %p', (text, expected) => {
    expect(parseDuration(text)).toBe(expected);
  });
});
