/**
 * Plate maths in the user's own unit: kg plates for kg users, lb plates for lb users, so
 * nothing is converted. Arithmetic is in hundredths to avoid float drift (2.5 + 1.25 …).
 */
import type { WeightUnit } from '@/api/types';

/** Standard plates per side, heaviest first. */
export const PLATES: Record<WeightUnit, number[]> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5],
};

/** Common bars: Olympic, women's/technique, and a light training bar. */
export const BARS: Record<WeightUnit, number[]> = {
  kg: [20, 15, 10],
  lb: [45, 35, 15],
};

const cents = (n: number) => Math.round(n * 100);

export interface PlateLoad {
  /** Plates for one side, heaviest first (a plate appears once per copy). */
  perSide: number[];
  /** What the bar weighs with those plates. */
  total: number;
  /** Target minus total; > 0 when the plates can't make the target exactly. */
  short: number;
}

/**
 * The plates for each side to reach `target` on `bar`, as close as possible without going
 * over (greedy, which is exact for standard plate sets). A target at or below the bar needs
 * no plates.
 */
export function loadBar(target: number, bar: number, plates: readonly number[]): PlateLoad {
  let side = Math.max(0, Math.floor((cents(target) - cents(bar)) / 2));
  const perSide: number[] = [];
  for (const plate of [...plates].sort((a, b) => b - a)) {
    const p = cents(plate);
    while (p > 0 && side >= p) {
      perSide.push(plate);
      side -= p;
    }
  }
  const total = (cents(bar) + 2 * perSide.reduce((sum, p) => sum + cents(p), 0)) / 100;
  return { perSide, total, short: Math.max(0, (cents(target) - cents(total)) / 100) };
}

/** The nearest weight the plates can make (never below the bar). */
export function roundToLoadable(weight: number, bar: number, plates: readonly number[]): number {
  const step = 2 * Math.min(...plates.map(cents));
  const over = Math.max(0, cents(weight) - cents(bar));
  return (cents(bar) + Math.round(over / step) * step) / 100;
}

/** "2 × 20, 1 × 2.5": a side's plates grouped. */
export function describePlates(perSide: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const plate of perSide) counts.set(plate, (counts.get(plate) ?? 0) + 1);
  return [...counts].map(([plate, n]) => `${n} × ${plate}`).join(', ');
}
