import {
  atClock,
  formatClock,
  formatDurationHM,
  parseClock,
  parseDurationHM,
  resolveTimes,
} from '../finishForm';

const START = new Date(2026, 9, 27, 18, 5).getTime();
const MIN = 60_000;

describe('clock times', () => {
  it('formats and parses', () => {
    expect(formatClock(START)).toBe('18:05');
    expect(formatClock(new Date(2026, 9, 27, 7, 0).getTime())).toBe('07:00');
  });

  it.each([
    ['18:05', 18 * 60 + 5],
    ['6:05', 6 * 60 + 5],
    ['6:05 pm', 18 * 60 + 5],
    ['12:30 AM', 30],
    ['12 pm', 12 * 60],
    ['6 am', 6 * 60],
    ['24:00', null],
    ['18:60', null],
    ['13 pm', null],
    ['18', null],
    ['noon', null],
  ])('%p → %p', (text, expected) => {
    expect(parseClock(text)).toBe(expected);
  });

  it('moves the time within the same day', () => {
    expect(atClock(START, 17 * 60 + 30)).toBe(new Date(2026, 9, 27, 17, 30).getTime());
  });
});

describe('durations', () => {
  it.each([
    [65 * MIN, '1:05'],
    [45 * MIN, '0:45'],
    [30_000, '0:01'],
  ])('%p ms → %p', (ms, text) => {
    expect(formatDurationHM(ms)).toBe(text);
  });

  it.each([
    ['1:05', 65 * MIN],
    ['0:45', 45 * MIN],
    ['90', 90 * MIN],
    ['1:75', null],
    ['1h', null],
  ])('%p → %p', (text, expected) => {
    expect(parseDurationHM(text)).toBe(expected);
  });
});

describe('resolveTimes', () => {
  const now = START + 4 * 60 * MIN;

  it('keeps the day and applies the duration', () => {
    expect(resolveTimes(START, '17:30', '1:00', now)).toEqual({
      times: { startedAt: atClock(START, 17 * 60 + 30), endedAt: atClock(START, 18 * 60 + 30) },
      errors: {},
    });
  });

  it.each([
    ['soon', '1:00', { start: 'Use a time like 18:05' }],
    ['18:05', 'long', { duration: 'Use hours:minutes, like 1:05' }],
    ['18:05', '0:00', { duration: 'At least 1 minute' }],
    ['18:05', '25:00', { duration: 'At most 24 hours' }],
    ['18:05', '5:00', { duration: "The workout can't end in the future" }],
  ])('%p for %p → %p', (start, duration, errors) => {
    expect(resolveTimes(START, start, duration, now)).toEqual({ times: null, errors });
  });

  it('reports both problems at once', () => {
    expect(resolveTimes(START, 'x', 'y', now).errors).toEqual({
      start: 'Use a time like 18:05',
      duration: 'Use hours:minutes, like 1:05',
    });
  });
});
