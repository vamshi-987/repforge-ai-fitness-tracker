import { ApiError } from '@/api/client';
import type { Routine, RoutineCreate, RoutineFolder, RoutineUpdate } from '@/api/types';
import { libraryRepo } from '@/exercises/library';
import { newId } from '@/lib/ids';
import { deletion, folderChange, routineChange } from '@/sync/changes';
import { queueChange } from '@/sync/queue';

import {
  buildRoutine,
  copyName,
  moveOutOfFolder,
  nextFolderPosition,
  nextPosition,
  reorderFolders as reorderFolderList,
  reorderRoutines as reorderRoutineList,
} from './local';
import { routineRepo } from './store';

// Every routine change is made on the device first, then queued for the server (the sync
// engine sends it when online). So routines can be created and edited offline.

/** The free plan's routine limit, checked on the device before the server checks again. */
export class RoutineLimitError extends Error {
  constructor(readonly limit: number) {
    super(`Free accounts can keep ${limit} routines.`);
    this.name = 'RoutineLimitError';
  }
}

async function checkLimit(): Promise<void> {
  const { routines, limit } = await routineRepo.load();
  if (limit !== null && routines.length >= limit) throw new RoutineLimitError(limit);
}

async function save(routines: Routine[]): Promise<void> {
  if (routines.length === 0) return;
  await routineRepo.putRoutines(routines);
  for (const routine of routines) await queueChange(routineChange(routine));
}

async function saveFolders(folders: RoutineFolder[]): Promise<void> {
  if (folders.length === 0) return;
  await routineRepo.putFolders(folders);
  for (const folder of folders) await queueChange(folderChange(folder));
}

const now = () => new Date().toISOString();

export async function createRoutine(body: RoutineCreate): Promise<Routine> {
  await checkLimit();
  const [{ routines }, { exercises }] = await Promise.all([routineRepo.load(), libraryRepo.load()]);
  const folderId = body.folder_id ?? null;
  const routine = buildRoutine(
    body.id ?? newId(),
    { ...body, folder_id: folderId, position: nextPosition(routines, folderId) },
    exercises,
    null,
    now(),
  );
  await save([routine]);
  return routine;
}

export async function updateRoutine(id: string, body: RoutineUpdate): Promise<Routine> {
  const [{ routines }, { exercises }] = await Promise.all([routineRepo.load(), libraryRepo.load()]);
  const previous = routines.find((r) => r.id === id);
  if (!previous) throw new ApiError(404, 'not_found', 'Routine not found');
  const moved = body.folder_id !== undefined && body.folder_id !== previous.folder_id;
  const routine = buildRoutine(
    id,
    // Moving into another folder puts the routine last there, like the server does.
    moved ? { ...body, position: nextPosition(routines, body.folder_id ?? null) } : body,
    exercises,
    previous,
    now(),
  );
  await save([routine]);
  return routine;
}

export async function deleteRoutine(id: string): Promise<void> {
  await routineRepo.removeRoutine(id);
  await queueChange(deletion('routine', id));
}

export async function duplicateRoutine(id: string): Promise<Routine> {
  await checkLimit();
  const { routines } = await routineRepo.load();
  const source = routines.find((r) => r.id === id);
  if (!source) throw new ApiError(404, 'not_found', 'Routine not found');
  const stamp = now();
  const copy: Routine = {
    ...source,
    id: newId(),
    name: copyName(source.name),
    position: nextPosition(routines, source.folder_id),
    version: 0,
    created_at: stamp,
    updated_at: stamp,
  };
  await save([copy]);
  return copy;
}

export async function reorderRoutines(folderId: string | null, ids: string[]): Promise<void> {
  const { routines } = await routineRepo.load();
  await save(reorderRoutineList(routines, folderId, ids));
}

export async function createFolder(name: string): Promise<RoutineFolder> {
  const { folders } = await routineRepo.load();
  const stamp = now();
  const folder: RoutineFolder = {
    id: newId(),
    name: name.split(/\s+/).filter(Boolean).join(' '),
    position: nextFolderPosition(folders),
    version: 0,
    created_at: stamp,
    updated_at: stamp,
  };
  await saveFolders([folder]);
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<RoutineFolder> {
  const { folders } = await routineRepo.load();
  const previous = folders.find((f) => f.id === id);
  if (!previous) throw new ApiError(404, 'not_found', 'Folder not found');
  const folder = {
    ...previous,
    name: name.split(/\s+/).filter(Boolean).join(' '),
    updated_at: now(),
  };
  await saveFolders([folder]);
  return folder;
}

/**
 * The folder's routines move out of it on the device at once. They aren't queued: the
 * server moves them the same way when it deletes the folder, and sync brings that back.
 */
export async function deleteFolder(id: string): Promise<void> {
  const { routines } = await routineRepo.load();
  await routineRepo.putRoutines(moveOutOfFolder(routines, id));
  await routineRepo.removeFolder(id);
  await queueChange(deletion('routine_folder', id));
}

export async function reorderFolders(ids: string[]): Promise<void> {
  const { folders } = await routineRepo.load();
  await saveFolders(reorderFolderList(folders, ids));
}

/** A message for a failed routine change. */
export function routineError(error: unknown): string {
  if (error instanceof RoutineLimitError)
    return `Free accounts can keep ${error.limit} routines. Delete one, or upgrade to Pro for unlimited routines.`;
  if (error instanceof ApiError && error.message) return error.message;
  return 'Something went wrong. Try again.';
}
