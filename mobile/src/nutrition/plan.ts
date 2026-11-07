/**
 * The meal plan: names and times to plan the day around. Only that: food is logged against the
 * day, so nothing here touches what's been eaten.
 */
import type { PlannedMeal } from '@/api/types';

export const MAX_PLANNED_MEALS = 12;
const MAX_NAME = 40;

/** "8", "8:30", "0830", "1pm" or "1:30 PM" → "HH:MM"; null when it isn't a time. */
export function parseMealTime(text: string): string | null {
  const match = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/i.exec(text.trim());
  if (!match) return null;
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  let hour = Number(match[1]);
  if (meridiem && (hour < 1 || hour > 12)) return null;
  if (meridiem) hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** "HH:MM" the way this phone shows times. */
export function formatMealTime(time: string): string {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The day's order: "HH:MM" sorts as text. */
export function sortPlan(plan: readonly PlannedMeal[]): PlannedMeal[] {
  return [...plan].sort((a, b) => a.time.localeCompare(b.time));
}

export interface PlannedMealErrors {
  name?: string;
  time?: string;
}

export function readPlannedMeal(
  name: string,
  time: string,
): { meal: PlannedMeal; errors: null } | { meal: null; errors: PlannedMealErrors } {
  const errors: PlannedMealErrors = {};
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) errors.name = 'Give it a name';
  else if (trimmed.length > MAX_NAME) errors.name = `Use at most ${MAX_NAME} characters`;
  const parsed = parseMealTime(time);
  if (parsed === null) errors.time = 'Use a time like 8:30 or 1:30 pm';
  if (parsed === null || errors.name) return { meal: null, errors };
  return { meal: { name: trimmed, time: parsed }, errors: null };
}
