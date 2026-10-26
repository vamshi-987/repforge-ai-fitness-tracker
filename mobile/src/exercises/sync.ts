import type { ApiResponse } from '@/api/client';
import * as exercisesApi from '@/api/exercises';
import type { Equipment, ExercisePage, Muscle } from '@/api/types';

import type { LibraryRepo } from './repo';

export const ETAG_KEYS = {
  muscles: 'etag:muscles',
  equipment: 'etag:equipment',
  exercises: 'etag:exercises',
} as const;

export interface LibraryApi {
  listMuscles(etag: string | null): Promise<ApiResponse<Muscle[]>>;
  listEquipment(etag: string | null): Promise<ApiResponse<Equipment[]>>;
  listExercisePage(cursor: string | null, etag: string | null): Promise<ApiResponse<ExercisePage>>;
}

async function syncList<T>(
  repo: LibraryRepo,
  key: string,
  fetchList: (etag: string | null) => Promise<ApiResponse<T[]>>,
  replace: (rows: T[]) => Promise<void>,
): Promise<boolean> {
  const response = await fetchList(await repo.getMeta(key));
  if (response.status === 304) return false;
  await replace(response.data ?? []);
  await repo.setMeta(key, response.etag);
  return true;
}

/**
 * Bring the device's library up to date. Each list is revalidated with its stored ETag, so an
 * unchanged library costs three empty 304s. A changed one is downloaded in full (one page of
 * up to 500) and replaces the local rows. Resolves true if anything changed; rejects when
 * offline, leaving the local copy as it was.
 */
export async function syncLibrary(
  repo: LibraryRepo,
  api: LibraryApi = exercisesApi,
): Promise<boolean> {
  const musclesChanged = await syncList(repo, ETAG_KEYS.muscles, api.listMuscles, (rows) =>
    repo.replaceMuscles(rows),
  );
  const equipmentChanged = await syncList(repo, ETAG_KEYS.equipment, api.listEquipment, (rows) =>
    repo.replaceEquipment(rows),
  );

  // The ETag covers the first page; later pages are fetched only when it changed.
  const first = await api.listExercisePage(null, await repo.getMeta(ETAG_KEYS.exercises));
  if (first.status === 304) return musclesChanged || equipmentChanged;
  const items = [...(first.data?.items ?? [])];
  let cursor = first.data?.next_cursor ?? null;
  while (cursor) {
    const page = await api.listExercisePage(cursor, null);
    items.push(...(page.data?.items ?? []));
    cursor = page.data?.next_cursor ?? null;
  }
  await repo.replaceExercises(items);
  await repo.setMeta(ETAG_KEYS.exercises, first.etag);
  return true;
}
