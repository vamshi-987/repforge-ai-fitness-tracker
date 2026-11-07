import type { Routine, RoutineExercise, RoutineFolder } from '@/api/types';

import { BENCH } from './library';

export function makeRoutineExercise(overrides: Partial<RoutineExercise> = {}): RoutineExercise {
  return {
    exercise_id: BENCH.id,
    exercise_name: BENCH.name,
    exercise_type: 'weight_reps',
    superset_group: null,
    rest_seconds: null,
    rep_range_min: 8,
    rep_range_max: 12,
    notes: '',
    sets: [
      { set_type: 'warmup', target_weight_kg: 40, target_reps: 10, target_duration_s: null },
      { set_type: 'normal', target_weight_kg: 60, target_reps: 8, target_duration_s: null },
      { set_type: 'normal', target_weight_kg: 60, target_reps: 8, target_duration_s: null },
    ],
    ...overrides,
  };
}

export function makeRoutine(overrides: Partial<Routine> & { name: string }): Routine {
  return {
    id: `r-${overrides.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    folder_id: null,
    notes: '',
    position: 0,
    exercises: [makeRoutineExercise()],
    version: 1,
    created_at: '2026-10-27T09:00:00Z',
    updated_at: '2026-10-27T09:00:00Z',
    ...overrides,
  };
}

export function makeFolder(overrides: Partial<RoutineFolder> & { name: string }): RoutineFolder {
  return {
    id: `f-${overrides.name.toLowerCase()}`,
    position: 0,
    version: 1,
    created_at: '2026-10-27T09:00:00Z',
    updated_at: '2026-10-27T09:00:00Z',
    ...overrides,
  };
}
