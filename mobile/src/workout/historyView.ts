/**
 * Pure helpers for the history screens. Dates are the phone's local time: a workout belongs
 * to the day and month it started on, where the user was.
 */
import type { SavedWorkout, WorkoutSummary } from './history';
import type { ActiveWorkout } from './types';

/** A finished workout can be changed this long after it ended (the server's rule too). */
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function canEdit(endedAt: number, now: number): boolean {
  return now <= endedAt + EDIT_WINDOW_MS;
}

/**
 * A saved workout as an editable draft, in the live workout's shape, so the editor reuses
 * the logging screen's set rows. Every saved set is ticked; unticking one drops it on save.
 */
export function toDraft(workout: SavedWorkout): ActiveWorkout {
  return {
    id: workout.id,
    routineId: workout.routineId,
    title: workout.title,
    notes: workout.notes,
    startedAt: workout.startedAt,
    exercises: workout.exercises.map((e) => ({
      ...e,
      sets: e.sets.map((s) => ({ ...s, completed: true })),
    })),
  };
}

/** "2026-10-27" in local time. */
export function dayKey(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface Month {
  year: number;
  /** 0–11, like Date. */
  month: number;
}

export function monthOf(ms: number): Month {
  const date = new Date(ms);
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function shiftMonth({ year, month }: Month, delta: number): Month {
  const date = new Date(year, month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function monthTitle({ year, month }: Month): string {
  return new Date(year, month, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
}

export interface MonthSection {
  key: string;
  title: string;
  data: WorkoutSummary[];
}

/** The history list's sections: one per month, newest first (input is newest first). */
export function groupByMonth(workouts: WorkoutSummary[]): MonthSection[] {
  const sections: MonthSection[] = [];
  for (const workout of workouts) {
    const month = monthOf(workout.startedAt);
    const key = `${month.year}-${month.month}`;
    const last = sections.at(-1);
    if (last?.key === key) last.data.push(workout);
    else sections.push({ key, title: monthTitle(month), data: [workout] });
  }
  return sections;
}

/**
 * The calendar's weeks for a month, Monday first: each cell is a day of the month or null
 * for the padding before the 1st and after the last day.
 */
export function monthGrid({ year, month }: Month): (number | null)[][] {
  const days = new Date(year, month + 1, 0).getDate();
  // getDay(): Sunday = 0; shift so Monday = 0.
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Day key → that day's workouts, oldest first. */
export function workoutsByDay(workouts: WorkoutSummary[]): Map<string, WorkoutSummary[]> {
  const byDay = new Map<string, WorkoutSummary[]>();
  for (const workout of [...workouts].sort((a, b) => a.startedAt - b.startedAt)) {
    const key = dayKey(workout.startedAt);
    byDay.set(key, [...(byDay.get(key) ?? []), workout]);
  }
  return byDay;
}

export function dayKeyOf({ year, month }: Month, day: number): string {
  return dayKey(new Date(year, month, day).getTime());
}
