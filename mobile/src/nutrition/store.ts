import { useQuery } from '@tanstack/react-query';

import * as nutritionApi from '@/api/nutrition';
import type { Food, NutritionTargets } from '@/api/types';

import type { NutritionRepo } from './repo';
import { byMeal, frequentFoods, mergeFoods, recentFoods, totals } from './rules';
import { sqliteNutritionRepo } from './sqliteRepo';

export const nutritionRepo: NutritionRepo = sqliteNutritionRepo;
export const NUTRITION_QUERY_KEY = ['nutrition'] as const;
export const SEARCH_MIN_CHARS = 2;
const SEARCH_LIMIT = 25;
/** Enough history for a useful Recent and Frequent list, without reading all of it. */
const RECENT_LOGS = 300;

const local = { staleTime: Infinity, networkMode: 'always' } as const;

/** One day's logs by meal, with totals, from the device (offline). */
export function useNutritionDay(day: string) {
  return useQuery({
    ...local,
    queryKey: [...NUTRITION_QUERY_KEY, 'day', day],
    queryFn: async () => {
      const logs = await nutritionRepo.logsOn(day);
      return { logs, meals: byMeal(logs), totals: totals(logs) };
    },
  });
}

/**
 * The server's targets, refreshed when it can be reached and kept for offline use. Null until
 * onboarding has the data to compute them.
 */
export async function loadTargets(day: string): Promise<NutritionTargets | null> {
  try {
    const targets = await nutritionApi.getTargets(day);
    await nutritionRepo.putTargets(targets);
    return targets;
  } catch {
    return nutritionRepo.targetsOn(day);
  }
}

export function useTargets(day: string) {
  return useQuery({
    queryKey: [...NUTRITION_QUERY_KEY, 'targets', day],
    queryFn: () => loadTargets(day),
    staleTime: 5 * 60_000,
    networkMode: 'always',
  });
}

export function useFood(id: string | null) {
  return useQuery({
    ...local,
    queryKey: [...NUTRITION_QUERY_KEY, 'food', id],
    queryFn: () => (id ? nutritionRepo.food(id) : null),
  });
}

export function useLog(id: string | null) {
  return useQuery({
    ...local,
    queryKey: [...NUTRITION_QUERY_KEY, 'log', id],
    queryFn: () => (id ? nutritionRepo.log(id) : null),
  });
}

export function useCustomFoods() {
  return useQuery({
    ...local,
    queryKey: [...NUTRITION_QUERY_KEY, 'custom'],
    queryFn: () => nutritionRepo.customFoods(),
  });
}

export function useSavedMeals() {
  return useQuery({
    ...local,
    queryKey: [...NUTRITION_QUERY_KEY, 'saved'],
    queryFn: () => nutritionRepo.savedMeals(),
  });
}

export function useRecentFoods() {
  return useQuery({
    ...local,
    queryKey: [...NUTRITION_QUERY_KEY, 'recent'],
    queryFn: async () => {
      const logs = await nutritionRepo.recentLogs(RECENT_LOGS);
      return { recent: recentFoods(logs), frequent: frequentFoods(logs) };
    },
  });
}

export interface FoodResults {
  items: Food[];
  searching: boolean;
  /** Only the foods on this device, or some online source, could be searched. */
  partial: boolean;
}

/** Foods on the device at once, then the server's as they arrive. */
export function useFoodSearch(query: string): FoodResults {
  const enabled = query.length >= SEARCH_MIN_CHARS;
  const onDevice = useQuery({
    ...local,
    queryKey: [...NUTRITION_QUERY_KEY, 'search', 'local', query],
    queryFn: () => nutritionRepo.searchFoods(query, SEARCH_LIMIT),
    enabled,
  });
  const online = useQuery({
    queryKey: ['food-search', query],
    queryFn: () => nutritionApi.searchFoods(query),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    networkMode: 'always',
  });
  return {
    items: enabled ? mergeFoods(onDevice.data ?? [], online.data?.items ?? []) : [],
    searching: enabled && online.isFetching,
    partial: enabled && (online.isError || online.data?.partial === true),
  };
}

const POLL_MS = 2000;

/** Polls until the worker has finished with the photo. */
export function usePhotoAnalysis(id: string | undefined) {
  return useQuery({
    queryKey: ['photo-analysis', id],
    queryFn: () => nutritionApi.getPhotoAnalysis(id ?? ''),
    enabled: id !== undefined,
    staleTime: Infinity,
    networkMode: 'always',
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? POLL_MS : false),
  });
}
