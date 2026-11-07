import * as routinesApi from '@/api/routines';
import type { RoutineFolder, RoutineList } from '@/api/types';
import { outboxKey } from '@/sync/outbox';

import type { RoutineRepo } from './repo';

export interface RoutinesApi {
  listRoutines(): Promise<RoutineList>;
  listFolders(): Promise<RoutineFolder[]>;
}

/**
 * Replace the device's routines with the server's. Routines are few, so both lists are
 * fetched whole. Rows with changes still queued for the server keep their local state (a
 * queued delete stays deleted). Rejects when offline and leaves the local copy as it was.
 */
export async function syncRoutines(
  repo: RoutineRepo,
  api: RoutinesApi = routinesApi,
  pending: () => Promise<Set<string>> = async () => new Set(),
): Promise<void> {
  const [list, folders] = await Promise.all([api.listRoutines(), api.listFolders()]);
  const [queued, local] = await Promise.all([pending(), repo.load()]);
  const merge = <T extends { id: string }>(
    entity: 'routine' | 'routine_folder',
    server: T[],
    mine: T[],
  ) => [
    ...server.filter((row) => !queued.has(outboxKey(entity, row.id))),
    ...mine.filter((row) => queued.has(outboxKey(entity, row.id))),
  ];
  await repo.replaceAll({
    routines: merge('routine', list.items, local.routines),
    folders: merge('routine_folder', folders, local.folders),
    limit: list.routine_limit,
  });
}
