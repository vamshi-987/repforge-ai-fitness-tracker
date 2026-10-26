import { session } from '@/auth/session';

import type { ApiResponse } from './client';
import type {
  Equipment,
  Exercise,
  ExerciseCreate,
  ExercisePage,
  ExerciseUpdate,
  Muscle,
} from './types';

/** The server's largest page: the whole library arrives in one request. */
export const LIBRARY_PAGE_SIZE = 500;

function revalidate(etag: string | null): { headers?: Record<string, string> } {
  return etag ? { headers: { 'If-None-Match': etag } } : {};
}

export function listExercisePage(
  cursor: string | null,
  etag: string | null = null,
): Promise<ApiResponse<ExercisePage>> {
  const query = new URLSearchParams({ limit: String(LIBRARY_PAGE_SIZE) });
  if (cursor) query.set('cursor', cursor);
  return session.requestFull<ExercisePage>(`/exercises?${query}`, revalidate(etag));
}

export function listMuscles(etag: string | null = null): Promise<ApiResponse<Muscle[]>> {
  return session.requestFull<Muscle[]>('/muscles', revalidate(etag));
}

export function listEquipment(etag: string | null = null): Promise<ApiResponse<Equipment[]>> {
  return session.requestFull<Equipment[]>('/equipment', revalidate(etag));
}

export function createExercise(body: ExerciseCreate): Promise<Exercise> {
  return session.request<Exercise>('/exercises', { method: 'POST', body });
}

export function updateExercise(id: string, body: ExerciseUpdate): Promise<Exercise> {
  return session.request<Exercise>(`/exercises/${id}`, { method: 'PATCH', body });
}

export function deleteExercise(id: string): Promise<void> {
  return session.request<void>(`/exercises/${id}`, { method: 'DELETE' });
}

export function duplicateExercise(id: string): Promise<Exercise> {
  return session.request<Exercise>(`/exercises/${id}/duplicate`, { method: 'POST', body: {} });
}
