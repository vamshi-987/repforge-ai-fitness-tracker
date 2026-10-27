import * as routinesApi from '@/api/routines';
import type { RoutineFolder, RoutineList } from '@/api/types';

import type { RoutineRepo } from './repo';

export interface RoutinesApi {
  listRoutines(): Promise<RoutineList>;
  listFolders(): Promise<RoutineFolder[]>;
}

/**
 * Replace the device's routines with the server's. Routines are few, so both lists are
 * fetched whole. Rejects when offline and leaves the local copy as it was.
 */
export async function syncRoutines(
  repo: RoutineRepo,
  api: RoutinesApi = routinesApi,
): Promise<void> {
  const [list, folders] = await Promise.all([api.listRoutines(), api.listFolders()]);
  await repo.replaceAll({ routines: list.items, folders, limit: list.routine_limit });
}
