/**
 * Warm-up sets before a working weight: the empty bar, then ramping sets of fewer reps,
 * each rounded to a weight the plates can make. Sets that would repeat the bar or each
 * other, or reach the working weight, are skipped.
 */
import { roundToLoadable } from './plates';

export const WARMUP_STEPS: readonly { percent: number; reps: number }[] = [
  { percent: 40, reps: 5 },
  { percent: 60, reps: 3 },
  { percent: 80, reps: 2 },
];

export interface WarmupSet {
  weight: number;
  reps: number;
  /** Of the working weight; null for the empty bar. */
  percent: number | null;
}

export function warmupSets(working: number, bar: number, plates: readonly number[]): WarmupSet[] {
  if (working <= bar) return [];
  const sets: WarmupSet[] = [{ weight: bar, reps: 10, percent: null }];
  for (const step of WARMUP_STEPS) {
    const weight = roundToLoadable((working * step.percent) / 100, bar, plates);
    const last = sets.at(-1)?.weight ?? bar;
    if (weight > last && weight < working)
      sets.push({ weight, reps: step.reps, percent: step.percent });
  }
  return sets;
}
