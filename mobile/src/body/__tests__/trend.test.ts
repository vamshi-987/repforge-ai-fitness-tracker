import type { BodyMeasurement } from '@/api/types';

import { createMemoryBodyRepo } from '../repo';
import { latestByKind, trendSeries, weeklyAverages, weekStartMs } from '../trend';

const at = (d: number, h = 7) => new Date(2026, 9, d, h).toISOString();
const weight = (d: number, kg: number) => ({ measured_at: at(d), weight_kg: kg });

describe('weight trend', () => {
  it('starts weeks on Monday in local time', () => {
    // 1 November 2026 is a Sunday; its week started on 26 October.
    expect(weekStartMs(new Date(2026, 10, 1, 23).getTime())).toBe(new Date(2026, 9, 26).getTime());
    expect(weekStartMs(new Date(2026, 9, 26, 0, 30).getTime())).toBe(
      new Date(2026, 9, 26).getTime(),
    );
  });

  it('averages a week only from 3 weigh-ins', () => {
    const weeks = weeklyAverages([
      weight(19, 80),
      weight(20, 80.4),
      weight(22, 79.8),
      weight(26, 79.5),
      weight(27, 79),
    ]);

    expect(weeks.map((w) => [new Date(w.weekStart).getDate(), w.weighIns, w.averageKg])).toEqual([
      [19, 3, 80.07],
      [26, 2, null],
    ]);
  });

  it('draws weigh-ins as dots and weekly averages mid-week', () => {
    const { dots, line } = trendSeries([weight(22, 79.8), weight(19, 80), weight(20, 80.4)]);

    expect(dots.map((d) => d.y)).toEqual([80, 80.4, 79.8]);
    expect(line).toEqual([{ x: new Date(2026, 9, 22, 12).getTime(), y: 80.07 }]);
    expect(trendSeries([])).toEqual({ dots: [], line: [] });
  });

  it('shows the latest of each measurement and its change', () => {
    const m = (id: string, d: number, kind: BodyMeasurement['kind'], value: number) =>
      ({ id, measured_at: at(d), kind, value }) as BodyMeasurement;

    const latest = latestByKind([
      m('a', 1, 'waist', 84),
      m('b', 8, 'waist', 82.6),
      m('c', 8, 'hips', 95),
    ]);

    expect(latest.get('waist')).toMatchObject({ latest: { id: 'b' }, change: -1.4 });
    expect(latest.get('hips')?.change).toBeNull();
  });
});

describe('memory body repo', () => {
  it('keeps rows newest first, upserts and clears', async () => {
    const repo = createMemoryBodyRepo();
    const row = {
      id: 'w',
      measured_at: at(2),
      weight_kg: 80,
      source: 'manual' as const,
      version: 0,
      created_at: '',
      updated_at: '',
    };
    await repo.putWeight({ ...row, id: 'old', measured_at: at(1) });
    await repo.putWeight(row);
    await repo.putWeight({ ...row, weight_kg: 79 });

    expect((await repo.weights()).map((w) => [w.id, w.weight_kg])).toEqual([
      ['w', 79],
      ['old', 80],
    ]);
    await repo.removeWeight('old');
    await repo.putMeasurement({
      id: 'm',
      measured_at: at(1),
      kind: 'neck',
      value: 38,
      version: 0,
      created_at: '',
      updated_at: '',
    });
    await repo.removeMeasurement('m');
    expect(await repo.measurements()).toEqual([]);
    await repo.clear();
    expect(await repo.weights()).toEqual([]);
  });
});
