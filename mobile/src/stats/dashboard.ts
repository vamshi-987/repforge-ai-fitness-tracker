import { useQuery } from '@tanstack/react-query';

import { getMuscleStats, getStatsSummary } from '@/api/stats';
import type { MuscleStats, StatsRange, WeekStats } from '@/api/types';

export const STATS_KEY = 'stats';

export type WeekMetric = 'workouts' | 'duration' | 'volume';

export const WEEK_METRICS: { value: WeekMetric; label: string }[] = [
  { value: 'workouts', label: 'Workouts' },
  { value: 'duration', label: 'Duration' },
  { value: 'volume', label: 'Volume' },
];

/** The bar values for a metric: workouts, hours, or kg. */
export function weekValues(weeks: WeekStats[], metric: WeekMetric): number[] {
  return weeks.map((w) =>
    metric === 'workouts' ? w.workouts : metric === 'duration' ? w.duration_s / 3600 : w.volume_kg,
  );
}

/** "5 Oct" under some bars: every bar when there are few, fewer as the range grows. */
export function weekLabels(weeks: WeekStats[], maxLabels = 6): string[] {
  const every = Math.max(1, Math.ceil(weeks.length / maxLabels));
  return weeks.map((w, i) =>
    (weeks.length - 1 - i) % every === 0
      ? new Date(`${w.week_start}T12:00:00`).toLocaleDateString([], {
          day: 'numeric',
          month: 'short',
        })
      : '',
  );
}

/** Body-map region → sets; muscles sharing a region add up. */
export function muscleIntensities(stats: MuscleStats): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of stats.muscles) out[m.body_map_key] = (out[m.body_map_key] ?? 0) + m.sets;
  return out;
}

/** "1 h 30 min", "45 min". */
export function formatHours(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes} min`;
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

export function useStatsSummary(range: StatsRange, enabled: boolean) {
  return useQuery({
    queryKey: [STATS_KEY, 'summary', range],
    queryFn: () => getStatsSummary(range),
    enabled,
    staleTime: 60_000,
  });
}

export function useMuscleStats(range: StatsRange, enabled: boolean) {
  return useQuery({
    queryKey: [STATS_KEY, 'muscles', range],
    queryFn: () => getMuscleStats(range),
    enabled,
    staleTime: 60_000,
  });
}
