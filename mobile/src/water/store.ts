import { useQuery } from '@tanstack/react-query';

import type { Me, WaterLog } from '@/api/types';
import { historyRepo } from '@/workout/historyStore';

import type { WaterRepo } from './repo';
import { dayStart, nextDayStart, totalMl, waterGoalMl } from './rules';
import { sqliteWaterRepo } from './sqliteRepo';

export const waterRepo: WaterRepo = sqliteWaterRepo;
export const WATER_QUERY_KEY = ['water'] as const;
export const HISTORY_DAYS = 14;

export interface WaterToday {
  logs: WaterLog[];
  totalMl: number;
  goalMl: number;
  trained: boolean;
}

/** Today's drinks and goal, from the device (offline). */
export async function loadToday(me: Me | null, now: number): Promise<WaterToday> {
  const start = dayStart(now);
  const end = nextDayStart(now);
  const [logs, workouts] = await Promise.all([waterRepo.between(start, end), historyRepo.list()]);
  const trained = workouts.some((w) => w.startedAt >= start && w.startedAt < end);
  return {
    logs,
    totalMl: totalMl(logs),
    goalMl: waterGoalMl(me?.profile.weight_kg ?? null, me?.profile.water_goal_ml ?? null, trained),
    trained,
  };
}

export function useWaterToday(me: Me | null, now: number) {
  return useQuery({
    queryKey: [
      ...WATER_QUERY_KEY,
      'today',
      dayStart(now),
      me?.profile.weight_kg,
      me?.profile.water_goal_ml,
    ],
    queryFn: () => loadToday(me, now),
    staleTime: Infinity,
    networkMode: 'always',
  });
}

/** The last HISTORY_DAYS days of drinks, for the history chart. */
export function useWaterHistory(now: number) {
  const end = nextDayStart(now);
  const start = end - (HISTORY_DAYS + 1) * 86_400_000;
  return useQuery({
    queryKey: [...WATER_QUERY_KEY, 'history', dayStart(now)],
    queryFn: () => waterRepo.between(start, end),
    staleTime: Infinity,
    networkMode: 'always',
  });
}
