/**
 * Water rules on the device, matching the server's (docs/api.md § Water): local days, a goal
 * of 35 ml/kg (or the user's own) plus 500 ml on a training day, and reminder times.
 */
import type { WaterLog } from '@/api/types';

export const ML_PER_KG = 35;
export const TRAINING_DAY_EXTRA_ML = 500;
export const FALLBACK_GOAL_ML = 2500;
export const MAX_REMINDERS = 16;
const HOUR_MS = 3_600_000;

export function dayStart(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** The next local midnight (a DST day is 23 or 25 hours, so never `start + 24 h`). */
export function nextDayStart(ms: number): number {
  const date = new Date(dayStart(ms));
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

export function waterGoalMl(
  weightKg: number | null,
  customGoalMl: number | null,
  trained: boolean,
): number {
  const base =
    customGoalMl ??
    (weightKg === null ? FALLBACK_GOAL_ML : Math.round((ML_PER_KG * weightKg) / 50) * 50);
  return base + (trained ? TRAINING_DAY_EXTRA_ML : 0);
}

export function totalMl(logs: Pick<WaterLog, 'amount_ml'>[]): number {
  return logs.reduce((sum, log) => sum + log.amount_ml, 0);
}

/** "07:00:00" → ms after local midnight. */
function clockMs(text: string): number {
  const [h = 0, m = 0] = text.split(':').map(Number);
  return (h * 60 + m) * 60_000;
}

export interface ReminderPlan {
  now: number;
  everyHours: number;
  /** HH:MM(:SS), local. */
  wake: string;
  sleep: string;
  /** Today's goal is reached: no more reminders today. */
  goalMet: boolean;
}

/**
 * When to remind: every `everyHours` after waking, until bedtime, today (only if the goal
 * isn't met yet, and only times still ahead) and tomorrow (the goal starts over). A bedtime
 * before the wake time means after midnight.
 */
export function reminderTimes({ now, everyHours, wake, sleep, goalMet }: ReminderPlan): number[] {
  const step = Math.max(1, everyHours) * HOUR_MS;
  const slots = (day: number) => {
    const from = day + clockMs(wake);
    let until = day + clockMs(sleep);
    if (until <= from) until += 24 * HOUR_MS;
    const out: number[] = [];
    for (let at = from + step; at < until; at += step) out.push(at);
    return out;
  };
  const today = goalMet ? [] : slots(dayStart(now)).filter((at) => at > now);
  return [...today, ...slots(nextDayStart(now))].slice(0, MAX_REMINDERS);
}

/** The last `days` local days, oldest first, with their totals. */
export function dailyTotals(logs: WaterLog[], days: number, now: number) {
  const out: { day: number; total: number }[] = [];
  let day = dayStart(now);
  for (let i = 0; i < days; i += 1) {
    const end = nextDayStart(day);
    const total = totalMl(
      logs.filter((l) => {
        const at = Date.parse(l.logged_at);
        return at >= day && at < end;
      }),
    );
    out.unshift({ day, total });
    const previous = new Date(day);
    previous.setDate(previous.getDate() - 1);
    day = previous.getTime();
  }
  return out;
}
