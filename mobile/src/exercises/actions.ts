import { ApiError } from '@/api/client';
import type { Exercise, ExerciseCreate, ExerciseUpdate } from '@/api/types';
import { newId } from '@/lib/ids';
import { copyName } from '@/routines/local';
import { deletion, exerciseChange } from '@/sync/changes';
import { queueChange } from '@/sync/queue';

import { libraryRepo } from './library';

// Custom exercise changes are made on the device first, then queued for the server, so
// they work offline. The form has already validated the input the way the server does.

async function save(exercise: Exercise): Promise<Exercise> {
  await libraryRepo.putExercise(exercise);
  await queueChange(exerciseChange(exercise));
  return exercise;
}

async function find(id: string): Promise<Exercise> {
  const exercise = (await libraryRepo.load()).exercises.find((e) => e.id === id);
  if (!exercise) throw new ApiError(404, 'not_found', 'Exercise not found');
  return exercise;
}

export async function createCustomExercise(body: ExerciseCreate): Promise<Exercise> {
  const stamp = new Date().toISOString();
  return save({
    id: body.id ?? newId(),
    name: body.name,
    type: body.type,
    equipment: body.equipment,
    primary_muscle: body.primary_muscle,
    secondary_muscles: [...body.secondary_muscles].sort(),
    instructions: body.instructions,
    media_video_url: null,
    media_thumb_url: null,
    media_license: null,
    is_custom: true,
    is_archived: false,
    version: 0,
    created_at: stamp,
    updated_at: stamp,
  });
}

export async function updateCustomExercise(id: string, body: ExerciseUpdate): Promise<Exercise> {
  const previous = await find(id);
  if (!previous.is_custom)
    throw new ApiError(403, 'library_exercise_read_only', "Library exercises can't be changed.");
  return save({
    ...previous,
    ...body,
    // The type never changes after save (the form doesn't offer it).
    type: previous.type,
    secondary_muscles: [...(body.secondary_muscles ?? previous.secondary_muscles)].sort(),
    updated_at: new Date().toISOString(),
  });
}

export async function deleteCustomExercise(id: string): Promise<void> {
  await libraryRepo.removeExercise(id);
  await queueChange(deletion('exercise', id));
}

/** A custom copy of any exercise (library or custom) that the user can then edit. */
export async function duplicateExercise(id: string): Promise<Exercise> {
  const source = await find(id);
  const stamp = new Date().toISOString();
  return save({
    ...source,
    id: newId(),
    name: copyName(source.name),
    is_custom: true,
    is_archived: false,
    version: 0,
    created_at: stamp,
    updated_at: stamp,
  });
}
