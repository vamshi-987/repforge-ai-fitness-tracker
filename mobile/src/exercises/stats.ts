import { useQuery } from '@tanstack/react-query';

import { getExerciseStats } from '@/api/stats';
import type { ExercisePoint, ExerciseStats, StatsRange } from '@/api/types';
import type { Datum } from '@/charts/geometry';

export const EXERCISE_STATS_KEY = 'exercise-stats';

export type MetricKey =
  'heaviest_kg' | 'e1rm_kg' | 'best_set_volume_kg' | 'session_volume_kg' | 'total_reps';

export interface Metric {
  key: MetricKey;
  label: string;
  /** Weights are shown in the user's unit; the rest are counts. */
  weight: boolean;
}

export const METRICS: Metric[] = [
  { key: 'heaviest_kg', label: 'Heaviest weight', weight: true },
  { key: 'e1rm_kg', label: 'Estimated 1RM', weight: true },
  { key: 'best_set_volume_kg', label: 'Best set volume', weight: true },
  { key: 'session_volume_kg', label: 'Session volume', weight: true },
  { key: 'total_reps', label: 'Total reps', weight: false },
];

export const RANGES: { value: StatsRange; label: string; pro: boolean }[] = [
  { value: '1m', label: '1 month', pro: false },
  { value: '3m', label: '3 months', pro: false },
  { value: '1y', label: '1 year', pro: true },
  { value: 'all', label: 'All', pro: true },
];

/** The metrics this exercise has data for (a bodyweight exercise has only total reps). */
export function availableMetrics(points: ExercisePoint[]): Metric[] {
  return METRICS.filter((m) => points.some((p) => p[m.key] !== null));
}

/** The chart's points for one metric; sessions without a value are left out. */
export function series(points: ExercisePoint[], key: MetricKey): (Datum & { rough: boolean })[] {
  return points.flatMap((p) => {
    const y = p[key];
    return y === null
      ? []
      : [{ x: Date.parse(p.started_at), y, rough: key === 'e1rm_kg' && p.e1rm_low_accuracy }];
  });
}

/** What a screen reader says for the chart. */
export function describeSeries(label: string, data: Datum[], format: (v: number) => string) {
  const first = data[0];
  const last = data.at(-1);
  if (!first || !last) return `${label}: no sessions in this range`;
  const best = Math.max(...data.map((d) => d.y));
  const sessions = `${data.length} session${data.length === 1 ? '' : 's'}`;
  return `${label} over ${sessions}: from ${format(first.y)} to ${format(last.y)}, best ${format(best)}`;
}

/** Chart data from the server; needs a connection (the History tab works offline). */
export function useExerciseStats(exerciseId: string, range: StatsRange, enabled: boolean) {
  return useQuery<ExerciseStats>({
    queryKey: [EXERCISE_STATS_KEY, exerciseId, range],
    queryFn: () => getExerciseStats(exerciseId, range),
    enabled,
    staleTime: 60_000,
  });
}
