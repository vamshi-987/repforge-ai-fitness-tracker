import { useQuery } from '@tanstack/react-query';

import { apiRequest } from './client';

export interface HealthResponse {
  status: 'ok';
  version: string;
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiRequest<HealthResponse>('/health', { signal });
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => getHealth(signal),
    retry: false,
    staleTime: 30_000,
  });
}
