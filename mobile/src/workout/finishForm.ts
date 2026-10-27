/**
 * The finish screen's editable start time and duration. Times are the phone's local time;
 * a changed start time stays on the day the workout started.
 */
const MINUTE = 60_000;
export const MAX_DURATION_MS = 24 * 60 * MINUTE;

const pad = (n: number) => String(n).padStart(2, '0');

/** "18:05". */
export function formatClock(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "18:05", "6:05", "6:05 pm", "6 am" → minutes after midnight; null if not a time. */
export function parseClock(text: string): number | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? '0');
  const meridiem = match[3]?.toLowerCase();
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === 'pm' ? 12 : 0);
  } else if (hours > 23 || match[2] === undefined) {
    return null;
  }
  return hours * 60 + minutes;
}

/** The same local day as `ms`, at `minutes` after midnight. */
export function atClock(ms: number, minutes: number): number {
  const date = new Date(ms);
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date.getTime();
}

/** "1:05" (hours:minutes). */
export function formatDurationHM(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE));
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

/** "1:05" or plain minutes ("65") → ms; null if not a duration. */
export function parseDurationHM(text: string): number | null {
  const trimmed = text.trim();
  const hm = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (hm) return Number(hm[2]) > 59 ? null : (Number(hm[1]) * 60 + Number(hm[2])) * MINUTE;
  return /^\d{1,4}$/.test(trimmed) ? Number(trimmed) * MINUTE : null;
}

export interface FinishTimes {
  startedAt: number;
  endedAt: number;
}

export interface FinishTimeErrors {
  start?: string;
  duration?: string;
}

/** Validate the typed start time and duration against the original start and now. */
export function resolveTimes(
  originalStart: number,
  startText: string,
  durationText: string,
  now: number,
): { times: FinishTimes | null; errors: FinishTimeErrors } {
  const errors: FinishTimeErrors = {};
  const minutes = parseClock(startText);
  const duration = parseDurationHM(durationText);
  if (minutes === null) errors.start = 'Use a time like 18:05';
  if (duration === null) errors.duration = 'Use hours:minutes, like 1:05';
  else if (duration < MINUTE) errors.duration = 'At least 1 minute';
  else if (duration > MAX_DURATION_MS) errors.duration = 'At most 24 hours';
  if (minutes === null || duration === null || errors.duration) return { times: null, errors };

  const startedAt = atClock(originalStart, minutes);
  const endedAt = startedAt + duration;
  // A minute of slack for the time spent on this screen.
  if (endedAt > now + MINUTE) {
    errors.duration = "The workout can't end in the future";
    return { times: null, errors };
  }
  return { times: { startedAt, endedAt }, errors };
}
