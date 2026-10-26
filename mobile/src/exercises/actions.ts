import * as api from '@/api/exercises';
import type { Exercise, ExerciseCreate, ExerciseUpdate } from '@/api/types';

import { libraryRepo } from './library';

// Custom exercise changes need the network until the Phase 4 sync engine adds an outbox.
// Each one updates the local copy at once, so the screens never wait for a full re-sync.

export async function createCustomExercise(body: ExerciseCreate): Promise<Exercise> {
  const created = await api.createExercise(body);
  await libraryRepo.putExercise(created);
  return created;
}

export async function updateCustomExercise(id: string, body: ExerciseUpdate): Promise<Exercise> {
  const updated = await api.updateExercise(id, body);
  await libraryRepo.putExercise(updated);
  return updated;
}

export async function deleteCustomExercise(id: string): Promise<void> {
  await api.deleteExercise(id);
  await libraryRepo.removeExercise(id);
}

export async function duplicateExercise(id: string): Promise<Exercise> {
  const copy = await api.duplicateExercise(id);
  await libraryRepo.putExercise(copy);
  return copy;
}
