import type { WaterLog } from '@/api/types';

import { createMemoryWaterRepo } from '../repo';
import {
  dailyTotals,
  dayStart,
  MAX_REMINDERS,
  nextDayStart,
  reminderTimes,
  totalMl,
  waterGoalMl,
} from '../rules';

const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const log = (id: string, at: number, ml: number): WaterLog => ({
  id,
  logged_at: new Date(at).toISOString(),
  amount_ml: ml,
  version: 0,
  created_at: '',
  updated_at: '',
});

describe('water goal', () => {
  it.each([
    [80, null, false, 2800],
    [80, null, true, 3300],
    [71.3, null, false, 2500],
    [null, null, false, 2500],
    [80, 2000, true, 2500],
  ])('weight %s, custom %s, trained %s → %i ml', (weight, custom, trained, goal) => {
    expect(waterGoalMl(weight, custom, trained)).toBe(goal);
  });

  it('adds up drinks', () => {
    expect(totalMl([{ amount_ml: 250 }, { amount_ml: 500 }])).toBe(750);
  });
});

describe('water reminders', () => {
  const plan = { everyHours: 2, wake: '07:00:00', sleep: '22:00:00' };

  it('reminds every 2 hours for the rest of today, and tomorrow', () => {
    const times = reminderTimes({ ...plan, now: local(30, 12, 30), goalMet: false });

    expect(times.slice(0, 5).map((t) => new Date(t).getHours())).toEqual([13, 15, 17, 19, 21]);
    expect(times.slice(5).map((t) => [new Date(t).getDate(), new Date(t).getHours()])).toEqual([
      [31, 9],
      [31, 11],
      [31, 13],
      [31, 15],
      [31, 17],
      [31, 19],
      [31, 21],
    ]);
  });

  it('stops for today once the goal is met, but keeps tomorrow', () => {
    const times = reminderTimes({ ...plan, now: local(30, 12, 30), goalMet: true });

    expect(times.every((t) => new Date(t).getDate() === 31)).toBe(true);
    expect(times).toHaveLength(7);
  });

  it('handles a bedtime after midnight and caps the count', () => {
    const late = reminderTimes({
      everyHours: 1,
      wake: '07:00',
      sleep: '01:00',
      now: local(30, 23, 10),
      goalMet: false,
    });

    expect(new Date(late[0] as number).getHours()).toBe(0);
    expect(late).toHaveLength(MAX_REMINDERS);
  });

  it('starts days at local midnight', () => {
    expect(dayStart(local(30, 15))).toBe(local(30, 0));
    expect(nextDayStart(local(30, 15))).toBe(local(31, 0));
  });
});

describe('water history', () => {
  it('totals the last days, oldest first, empty days included', async () => {
    const repo = createMemoryWaterRepo();
    await repo.put(log('a', local(30, 8), 250));
    await repo.put(log('b', local(30, 9), 500));
    await repo.put(log('c', local(28, 9), 1000));
    await repo.put({ ...log('b', local(30, 9), 400) });
    await repo.remove('missing');

    const days = dailyTotals(await repo.between(local(1, 0), local(31, 0)), 3, local(30, 20));

    expect(days.map((d) => [new Date(d.day).getDate(), d.total])).toEqual([
      [28, 1000],
      [29, 0],
      [30, 650],
    ]);
    await repo.clear();
    expect(repo.rows).toEqual([]);
  });
});
