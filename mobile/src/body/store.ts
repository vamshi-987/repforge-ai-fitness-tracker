import { useQuery } from '@tanstack/react-query';

import type { BodyRepo } from './repo';
import { sqliteBodyRepo } from './sqliteRepo';

export const bodyRepo: BodyRepo = sqliteBodyRepo;
export const BODY_QUERY_KEY = ['body'] as const;

/** Weigh-ins on the device, newest first (offline). */
export function useWeights() {
  return useQuery({
    queryKey: [...BODY_QUERY_KEY, 'weights'],
    queryFn: () => bodyRepo.weights(),
    staleTime: Infinity,
    networkMode: 'always',
  });
}

export function useMeasurements() {
  return useQuery({
    queryKey: [...BODY_QUERY_KEY, 'measurements'],
    queryFn: () => bodyRepo.measurements(),
    staleTime: Infinity,
    networkMode: 'always',
  });
}
