import { session } from '@/auth/session';

import type { SyncChange, SyncPull, SyncResult } from './types';

export async function pushChanges(changes: SyncChange[]): Promise<SyncResult[]> {
  const body = await session.request<{ results: SyncResult[] }>('/sync/push', {
    method: 'POST',
    body: { changes },
  });
  return body.results;
}

export function pullChanges(since: number, limit: number): Promise<SyncPull> {
  return session.request<SyncPull>(`/sync/pull?since=${since}&limit=${limit}`);
}
