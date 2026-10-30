import { session } from '@/auth/session';

import type { ExerciseStats, MuscleStats, StatsRange, StatsSummary } from './types';

export function getExerciseStats(exerciseId: string, range: StatsRange): Promise<ExerciseStats> {
  return session.request<ExerciseStats>(`/exercises/${exerciseId}/stats?range=${range}`);
}

export function getStatsSummary(range: StatsRange): Promise<StatsSummary> {
  return session.request<StatsSummary>(`/stats/summary?range=${range}`);
}

export function getMuscleStats(range: StatsRange): Promise<MuscleStats> {
  return session.request<MuscleStats>(`/stats/muscles?range=${range}`);
}
