/**
 * Chart geometry, pure, so the SVG components only draw. Our own charts replace victory-native
 * (CLAUDE.md §2): its current version needs a newer Skia than Expo Go ships (PROGRESS.md).
 */

export interface Datum {
  /** Usually epoch ms. */
  x: number;
  y: number;
}

/** Drawing area: the SVG size and the room kept for labels on each side. */
export interface Frame {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * The y range to draw: the data's range with 10% room above and below, so lines don't touch
 * the edges. A flat series gets room around its value; never below 0 for non-negative data.
 */
export function yDomain(values: number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = max === min ? Math.max(Math.abs(max) * 0.1, 1) : (max - min) * 0.1;
  const low = min >= 0 ? Math.max(0, min - pad) : min - pad;
  return [low, max + pad];
}

/** Points of a line chart, x by value (time) and y by `yDomain`; one point is centred. */
export function linePoints(data: Datum[], frame: Frame): Point[] {
  if (data.length === 0) return [];
  const xs = data.map((d) => d.x);
  const [low, high] = yDomain(data.map((d) => d.y));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const innerW = frame.width - frame.left - frame.right;
  const innerH = frame.height - frame.top - frame.bottom;
  return data.map((d) => ({
    x: frame.left + (xMax === xMin ? innerW / 2 : ((d.x - xMin) / (xMax - xMin)) * innerW),
    y: frame.top + innerH - ((d.y - low) / (high - low)) * innerH,
  }));
}

/** SVG path through the points: "M x y L x y …". */
export function linePath(points: Point[]): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
}

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bars from zero, sharing the width evenly with a gap; an all-zero series draws nothing. */
export function bars(values: number[], frame: Frame, gap = 0.25): Bar[] {
  const max = Math.max(0, ...values);
  const innerW = frame.width - frame.left - frame.right;
  const innerH = frame.height - frame.top - frame.bottom;
  const slot = values.length ? innerW / values.length : 0;
  return values.map((value, i) => {
    const height = max > 0 ? (Math.max(0, value) / max) * innerH : 0;
    return {
      x: frame.left + i * slot + (slot * gap) / 2,
      y: frame.top + innerH - height,
      width: slot * (1 - gap),
      height,
    };
  });
}
