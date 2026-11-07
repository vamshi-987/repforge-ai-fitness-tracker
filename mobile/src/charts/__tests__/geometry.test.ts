import { bars, linePath, linePoints, yDomain, type Frame } from '../geometry';

const FRAME: Frame = { width: 120, height: 70, left: 10, right: 10, top: 10, bottom: 10 };

describe('chart geometry', () => {
  it('pads the y range and never goes below zero for positive data', () => {
    expect(yDomain([100, 200])).toEqual([90, 210]);
    expect(yDomain([5, 10])).toEqual([4.5, 10.5]);
    expect(yDomain([0.5, 50])).toEqual([0, 54.95]);
    expect(yDomain([80, 80])).toEqual([72, 88]);
    expect(yDomain([0, 0])).toEqual([0, 1]);
    expect(yDomain([-10, 10])).toEqual([-12, 12]);
  });

  it('places points by time and value inside the frame', () => {
    const points = linePoints(
      [
        { x: 0, y: 100 },
        { x: 50, y: 150 },
        { x: 100, y: 200 },
      ],
      FRAME,
    );
    expect(points.map((p) => p.x)).toEqual([10, 60, 110]);
    // The y range is 90..210 over 50 px.
    expect(points[0]?.y).toBeCloseTo(60 - (10 / 120) * 50);
    expect(points[2]?.y).toBeCloseTo(60 - (110 / 120) * 50);
    expect(linePoints([{ x: 5, y: 1 }], FRAME)[0]?.x).toBe(60);
    expect(linePoints([], FRAME)).toEqual([]);
  });

  it('writes an SVG path', () => {
    expect(
      linePath([
        { x: 1, y: 2 },
        { x: 3.25, y: 4 },
      ]),
    ).toBe('M1.0 2.0 L3.3 4.0');
  });

  it('draws bars from zero, scaled to the highest', () => {
    const drawn = bars([0, 50, 100, -5], FRAME, 0);
    expect(drawn.map((b) => [b.x, b.width, b.height])).toEqual([
      [10, 25, 0],
      [35, 25, 25],
      [60, 25, 50],
      [85, 25, 0],
    ]);
    expect(drawn[2]?.y).toBe(10);
    expect(bars([0, 0], FRAME).every((b) => b.height === 0)).toBe(true);
  });
});
