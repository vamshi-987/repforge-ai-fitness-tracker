import { session } from '@/auth/session';

import type { Routine, RoutineCreate, RoutineFolder, RoutineList, RoutineUpdate } from './types';

export function listRoutines(): Promise<RoutineList> {
  return session.request<RoutineList>('/routines');
}

export function createRoutine(body: RoutineCreate): Promise<Routine> {
  return session.request<Routine>('/routines', { method: 'POST', body });
}

export function updateRoutine(id: string, body: RoutineUpdate): Promise<Routine> {
  return session.request<Routine>(`/routines/${id}`, { method: 'PATCH', body });
}

export function deleteRoutine(id: string): Promise<void> {
  return session.request<void>(`/routines/${id}`, { method: 'DELETE' });
}

export function duplicateRoutine(id: string): Promise<Routine> {
  return session.request<Routine>(`/routines/${id}/duplicate`, { method: 'POST', body: {} });
}

export function reorderRoutines(
  folderId: string | null,
  routineIds: string[],
): Promise<RoutineList> {
  return session.request<RoutineList>('/routines/reorder', {
    method: 'POST',
    body: { folder_id: folderId, routine_ids: routineIds },
  });
}

export function listFolders(): Promise<RoutineFolder[]> {
  return session.request<RoutineFolder[]>('/routine-folders');
}

export function createFolder(name: string): Promise<RoutineFolder> {
  return session.request<RoutineFolder>('/routine-folders', { method: 'POST', body: { name } });
}

export function renameFolder(id: string, name: string): Promise<RoutineFolder> {
  return session.request<RoutineFolder>(`/routine-folders/${id}`, {
    method: 'PATCH',
    body: { name },
  });
}

export function deleteFolder(id: string): Promise<void> {
  return session.request<void>(`/routine-folders/${id}`, { method: 'DELETE' });
}

export function reorderFolders(folderIds: string[]): Promise<RoutineFolder[]> {
  return session.request<RoutineFolder[]>('/routine-folders/reorder', {
    method: 'POST',
    body: { folder_ids: folderIds },
  });
}
