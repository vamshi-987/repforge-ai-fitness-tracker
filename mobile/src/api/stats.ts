import { session } from '@/auth/session';

import type { ExerciseStats, StatsRange } from './types';

export function getExerciseStats(exerciseId: string, range: StatsRange): Promise<ExerciseStats> {
  return session.request<ExerciseStats>(`/exercises/${exerciseId}/stats?range=${range}`);
}
