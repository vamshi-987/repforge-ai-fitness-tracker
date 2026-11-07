import { session } from '@/auth/session';

import type { NutritionTargets, OverloadSuggestion, WeeklyReport } from './types';

export function getWeeklyReport(): Promise<WeeklyReport> {
  return session.request<WeeklyReport>('/coach/weekly-report');
}

export function applyWeeklyReport(id: string): Promise<NutritionTargets> {
  return session.request<NutritionTargets>(`/coach/weekly-report/${id}/apply`, { method: 'POST' });
}

export function getRoutineOverload(routineId: string): Promise<{ items: OverloadSuggestion[] }> {
  return session.request(`/coach/overload?routine_id=${routineId}`);
}
