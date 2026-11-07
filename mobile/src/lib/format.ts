/** Rest timer length: "1:30", "0:45", or "Off" for 0 (no automatic rest timer). */
export function formatRest(seconds: number): string {
  if (seconds <= 0) return 'Off';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Clamp to [min, max] and snap to the nearest `step`. */
export function stepValue(value: number, delta: number, min: number, max: number, step: number) {
  const snapped = Math.round((value + delta) / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

/** A duration in seconds: "0:45", "1:30", "1:02:03". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/**
 * Parse a typed duration: "90" (seconds), "1:30" (m:ss) or "1:02:03" (h:mm:ss). Every part
 * after the first must be below 60. Null if it isn't a duration.
 */
export function parseDuration(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.slice(1).some((n) => n >= 60)) return null;
  return numbers.reduce((total, n) => total * 60 + n, 0);
}
