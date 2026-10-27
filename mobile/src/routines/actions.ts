import * as api from '@/api/routines';
import { ApiError } from '@/api/client';
import type { Routine, RoutineCreate, RoutineFolder, RoutineUpdate } from '@/api/types';

import { refreshRoutines, routineRepo } from './store';

// Routine changes need the network until the Phase 4 sync engine adds an outbox. Each one
// writes the server's answer to the device at once, so the screens never wait for a re-sync.

export async function createRoutine(body: RoutineCreate): Promise<Routine> {
  const created = await api.createRoutine(body);
  await routineRepo.putRoutines([created]);
  return created;
}

export async function updateRoutine(id: string, body: RoutineUpdate): Promise<Routine> {
  const updated = await api.updateRoutine(id, body);
  await routineRepo.putRoutines([updated]);
  return updated;
}

export async function deleteRoutine(id: string): Promise<void> {
  await api.deleteRoutine(id);
  await routineRepo.removeRoutine(id);
}

export async function duplicateRoutine(id: string): Promise<Routine> {
  const copy = await api.duplicateRoutine(id);
  await routineRepo.putRoutines([copy]);
  return copy;
}

export async function reorderRoutines(folderId: string | null, ids: string[]): Promise<void> {
  const list = await api.reorderRoutines(folderId, ids);
  await routineRepo.putRoutines(list.items);
}

export async function createFolder(name: string): Promise<RoutineFolder> {
  const folder = await api.createFolder(name);
  await routineRepo.putFolders([folder]);
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<RoutineFolder> {
  const folder = await api.renameFolder(id, name);
  await routineRepo.putFolders([folder]);
  return folder;
}

/** The server moves the folder's routines out of it, so pull the new positions. */
export async function deleteFolder(id: string): Promise<void> {
  await api.deleteFolder(id);
  await routineRepo.removeFolder(id);
  await refreshRoutines().catch(() => undefined);
}

export async function reorderFolders(ids: string[]): Promise<void> {
  await routineRepo.putFolders(await api.reorderFolders(ids));
}

/** A message for a failed routine change. */
export function routineError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'network_error')
    return "You're offline. Routines can be changed once you're back online.";
  if (error instanceof ApiError && error.code === 'routine_limit_reached') {
    const limit = (error.details as { limit?: number } | null)?.limit;
    return `Free accounts can keep ${limit ?? 'a few'} routines. Delete one, or upgrade to Pro for unlimited routines.`;
  }
  if (error instanceof ApiError && error.message) return error.message;
  return 'Something went wrong. Try again.';
}
