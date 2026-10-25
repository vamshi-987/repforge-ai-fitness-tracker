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
