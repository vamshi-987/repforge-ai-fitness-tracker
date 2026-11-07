import { session } from '@/auth/session';

import type { ImportReport } from './types';

export function exportEverything(): Promise<unknown> {
  return session.request<unknown>('/me/export');
}

export function exportWorkoutsCsv(): Promise<string> {
  return session.request<string>('/me/export/workouts.csv', { asText: true });
}

export function importWorkoutsCsv(uri: string, name: string): Promise<ImportReport> {
  const form = new FormData();
  // React Native's FormData takes a file as { uri, name, type }; the DOM types only know Blob.
  form.append('file', { uri, name, type: 'text/csv' } as unknown as Blob);
  return session.request<ImportReport>('/me/import/workouts', { method: 'POST', form });
}

export function closeAccount(): Promise<void> {
  return session.request<void>('/me', { method: 'DELETE', body: { confirm: 'DELETE' } });
}
