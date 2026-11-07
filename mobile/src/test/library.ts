import type { Equipment, Exercise, Muscle } from '@/api/types';

export const MUSCLES: Muscle[] = [
  { id: 'm-chest', slug: 'chest', name: 'Chest', body_map_key: 'chest' },
  { id: 'm-front', slug: 'front_delts', name: 'Front Delts', body_map_key: 'front_delts' },
  { id: 'm-tri', slug: 'triceps', name: 'Triceps', body_map_key: 'triceps' },
  { id: 'm-lats', slug: 'lats', name: 'Lats', body_map_key: 'lats' },
  { id: 'm-bi', slug: 'biceps', name: 'Biceps', body_map_key: 'biceps' },
  { id: 'm-quads', slug: 'quads', name: 'Quads', body_map_key: 'quads' },
];

export const EQUIPMENT: Equipment[] = [
  { id: 'e-bb', slug: 'barbell', name: 'Barbell', increment_kg: 2.5 },
  { id: 'e-db', slug: 'dumbbell', name: 'Dumbbell', increment_kg: 2 },
  { id: 'e-cable', slug: 'cable', name: 'Cable', increment_kg: 2.5 },
  { id: 'e-bw', slug: 'bodyweight', name: 'Bodyweight', increment_kg: null },
];

export function makeExercise(overrides: Partial<Exercise> & { name: string }): Exercise {
  return {
    id: overrides.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    type: 'weight_reps',
    equipment: 'barbell',
    primary_muscle: 'chest',
    secondary_muscles: [],
    instructions: ['Step one.', 'Step two.', 'Step three.'],
    media_video_url: null,
    media_thumb_url: null,
    media_license: null,
    is_custom: false,
    is_archived: false,
    version: 1,
    created_at: '2026-10-26T09:00:00Z',
    updated_at: '2026-10-26T09:00:00Z',
    ...overrides,
  };
}

export const BENCH = makeExercise({
  id: 'e7b40f5a-46df-5073-9161-a5081fb0e120',
  name: 'Bench Press (Barbell)',
  secondary_muscles: ['front_delts', 'triceps'],
  instructions: ['Lie on the bench.', 'Lower the bar to your chest.', 'Press it back up.'],
});

export const EXERCISES: Exercise[] = [
  BENCH,
  makeExercise({
    name: 'Bench Press (Dumbbell)',
    equipment: 'dumbbell',
    secondary_muscles: ['front_delts', 'triceps'],
  }),
  makeExercise({
    name: 'Close-Grip Bench Press (Barbell)',
    primary_muscle: 'triceps',
    secondary_muscles: ['chest'],
  }),
  makeExercise({ name: 'Lat Pulldown (Cable)', equipment: 'cable', primary_muscle: 'lats' }),
  makeExercise({ name: 'Bicep Curl (Dumbbell)', equipment: 'dumbbell', primary_muscle: 'biceps' }),
  makeExercise({
    name: 'Push-Up',
    type: 'bodyweight_reps',
    equipment: 'bodyweight',
    secondary_muscles: ['triceps'],
  }),
  makeExercise({ name: 'Squat (Barbell)', primary_muscle: 'quads' }),
  makeExercise({ name: 'Retired Bench Thing', is_archived: true }),
];
