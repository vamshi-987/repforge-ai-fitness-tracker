import {
  BODY_MAP_KEYS,
  HEAT_SCALE,
  REGIONS,
  TARGET_COLORS,
  bestView,
  describeTargets,
  heatFills,
  isBodyMapKey,
  targetFills,
  withNeutral,
  HIGHLIGHTER_SLUGS,
} from '../regions';

const bySlug = (fills: { slug: string; color: string }[]) =>
  Object.fromEntries(fills.map((f) => [f.slug, f.color]));

describe('REGIONS', () => {
  it('maps every body map key to a drawn region', () => {
    expect(Object.keys(REGIONS).sort()).toEqual([...BODY_MAP_KEYS].sort());
    for (const key of BODY_MAP_KEYS) expect(REGIONS[key].views.length).toBeGreaterThan(0);
  });

  it('recognises keys', () => {
    expect(isBodyMapKey('chest')).toBe(true);
    expect(isBodyMapKey('wings')).toBe(false);
    expect(isBodyMapKey('toString')).toBe(false);
  });
});

describe('targetFills', () => {
  it('colours the bench press: chest red, front delts and triceps light red', () => {
    const front = bySlug(targetFills(['chest'], ['front_delts', 'triceps'], 'front'));

    expect(front).toEqual({
      chest: TARGET_COLORS.primary,
      deltoids: TARGET_COLORS.secondary,
      triceps: TARGET_COLORS.secondary,
    });
  });

  it('only draws muscles on the views where they are visible', () => {
    const back = bySlug(targetFills(['chest'], ['front_delts', 'triceps'], 'back'));

    expect(back).toEqual({ triceps: TARGET_COLORS.secondary });
  });

  it('lets a primary muscle win a shared region', () => {
    const back = bySlug(targetFills(['lats'], ['upper_back', 'rear_delts'], 'back'));

    expect(back['upper-back']).toBe(TARGET_COLORS.primary);
    expect(back.deltoids).toBe(TARGET_COLORS.secondary);
  });

  it('ignores unknown keys and accepts custom colours', () => {
    const fills = targetFills(['chest', 'wings'], [], 'front', {
      primary: '#000',
      secondary: '#111',
    });

    expect(fills).toEqual([{ slug: 'chest', color: '#000' }]);
  });
});

describe('heatFills', () => {
  it('shades relative to the most-trained muscle', () => {
    const front = bySlug(heatFills({ chest: 12, quads: 6, biceps: 1, abs: 0 }, 'front'));

    expect(front.chest).toBe(HEAT_SCALE[3]);
    expect(front.quadriceps).toBe(HEAT_SCALE[1]);
    expect(front.biceps).toBe(HEAT_SCALE[0]);
    expect(front.abs).toBeUndefined();
  });

  it('keeps the larger value when muscles share a region', () => {
    const back = bySlug(heatFills({ lats: 2, upper_back: 8 }, 'back'));

    expect(back['upper-back']).toBe(HEAT_SCALE[3]);
  });

  it('draws nothing without positive values', () => {
    expect(heatFills({}, 'front')).toEqual([]);
    expect(heatFills({ chest: 0, quads: -1, abs: Number.NaN }, 'front')).toEqual([]);
    expect(heatFills({ chest: 3 }, 'front', [])).toEqual([]);
  });
});

describe('bestView', () => {
  it.each([
    [['chest'], [], 'front'],
    [['lats'], ['biceps'], 'back'],
    [['side_delts'], [], 'front'],
    [[], ['hamstrings'], 'back'],
    [['wings'], [], 'front'],
    [[], [], 'front'],
  ] as const)('%j / %j → %s', (primary, secondary, view) => {
    expect(bestView(primary, secondary)).toBe(view);
  });
});

describe('describeTargets', () => {
  it('names the muscles for screen readers', () => {
    expect(describeTargets(['chest'], ['front_delts', 'triceps'])).toBe(
      'Primary: Chest. Secondary: Front Delts, Triceps.',
    );
    expect(describeTargets([], [])).toBe('Primary: none.');
  });
});

describe('withNeutral', () => {
  it('colours every other region neutral', () => {
    const fills = withNeutral([{ slug: 'chest', color: '#f00' }], '#ccc');

    expect(fills).toHaveLength(HIGHLIGHTER_SLUGS.length);
    expect(bySlug(fills).chest).toBe('#f00');
    expect(bySlug(fills).head).toBe('#ccc');
  });

  it('covers every region our muscles use', () => {
    for (const key of BODY_MAP_KEYS) expect(HIGHLIGHTER_SLUGS).toContain(REGIONS[key].slug);
  });
});
