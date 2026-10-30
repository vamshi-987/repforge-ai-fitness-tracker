/**
 * Weight trend maths on the device, matching the server's (docs/api.md § Body): Monday
 * weeks in local time, and a weekly average only from 3 weigh-ins.
 */
import type { BodyMeasurement, BodyWeight, MeasurementKind } from '@/api/types';
import type { Datum } from '@/charts/geometry';
import { roundTo } from '@/lib/units';

export const MIN_WEIGH_INS = 3;
const DAY_MS = 86_400_000;

/** Monday 00:00 local time of the week `ms` falls in. */
export function weekStartMs(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

export interface WeekAverage {
  weekStart: number;
  weighIns: number;
  /** null below 3 weigh-ins. */
  averageKg: number | null;
}

/** Oldest first; only weeks with a weigh-in. */
export function weeklyAverages(weights: Pick<BodyWeight, 'measured_at' | 'weight_kg'>[]) {
  const weeks = new Map<number, number[]>();
  for (const w of weights) {
    const key = weekStartMs(Date.parse(w.measured_at));
    weeks.set(key, [...(weeks.get(key) ?? []), w.weight_kg]);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([weekStart, values]): WeekAverage => ({
      weekStart,
      weighIns: values.length,
      averageKg:
        values.length >= MIN_WEIGH_INS
          ? roundTo(values.reduce((sum, v) => sum + v, 0) / values.length, 2)
          : null,
    }));
}

/** The chart's two series: every weigh-in as a dot, and the weekly averages as a line
 * (each placed mid-week). */
export function trendSeries(weights: Pick<BodyWeight, 'measured_at' | 'weight_kg'>[]): {
  dots: Datum[];
  line: Datum[];
} {
  return {
    dots: weights
      .map((w) => ({ x: Date.parse(w.measured_at), y: w.weight_kg }))
      .sort((a, b) => a.x - b.x),
    line: weeklyAverages(weights).flatMap((w) =>
      w.averageKg === null ? [] : [{ x: w.weekStart + 3.5 * DAY_MS, y: w.averageKg }],
    ),
  };
}

/** The latest measurement of each kind, plus the change since the one before it. */
export function latestByKind(
  rows: BodyMeasurement[],
): Map<MeasurementKind, { latest: BodyMeasurement; change: number | null }> {
  const byKind = new Map<MeasurementKind, BodyMeasurement[]>();
  for (const row of [...rows].sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at)))
    byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row]);
  const result = new Map<MeasurementKind, { latest: BodyMeasurement; change: number | null }>();
  for (const [kind, list] of byKind) {
    const [latest, before] = list;
    if (latest)
      result.set(kind, {
        latest,
        change: before ? roundTo(latest.value - before.value, 1) : null,
      });
  }
  return result;
}
