import type { Slug } from 'react-native-body-highlighter';

import { palette } from '@/theme/tokens';

/** Our muscle regions, as `muscles.body_map_key` on the server (CLAUDE.md §8). */
export const BODY_MAP_KEYS = [
  'chest',
  'front_delts',
  'side_delts',
  'rear_delts',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'lats',
  'upper_back',
  'traps',
  'lower_back',
  'glutes',
  'quads',
  'hamstrings',
  'adductors',
  'abductors',
  'calves',
  'neck',
] as const;

export type BodyMapKey = (typeof BODY_MAP_KEYS)[number];
export type BodyView = 'front' | 'back';

interface Region {
  slug: Slug;
  views: readonly BodyView[];
}

const FRONT: readonly BodyView[] = ['front'];
const BACK: readonly BodyView[] = ['back'];
const BOTH: readonly BodyView[] = ['front', 'back'];

/**
 * Where each of our muscles is drawn on the highlighter's figure.
 *
 * The figure has one "deltoids" and one "upper-back" region, so the three delt heads share
 * one region (the view picks which heads count: front delts only light up the front figure,
 * rear delts only the back one), and lats share "upper-back" with the upper back. Abductors
 * (glute medius) are drawn as the glutes.
 */
export const REGIONS: Record<BodyMapKey, Region> = {
  chest: { slug: 'chest', views: FRONT },
  front_delts: { slug: 'deltoids', views: FRONT },
  side_delts: { slug: 'deltoids', views: BOTH },
  rear_delts: { slug: 'deltoids', views: BACK },
  biceps: { slug: 'biceps', views: FRONT },
  triceps: { slug: 'triceps', views: BOTH },
  forearms: { slug: 'forearm', views: BOTH },
  abs: { slug: 'abs', views: FRONT },
  obliques: { slug: 'obliques', views: FRONT },
  lats: { slug: 'upper-back', views: BACK },
  upper_back: { slug: 'upper-back', views: BACK },
  traps: { slug: 'trapezius', views: BOTH },
  lower_back: { slug: 'lower-back', views: BACK },
  glutes: { slug: 'gluteal', views: BACK },
  quads: { slug: 'quadriceps', views: FRONT },
  hamstrings: { slug: 'hamstring', views: BACK },
  adductors: { slug: 'adductors', views: BOTH },
  abductors: { slug: 'gluteal', views: BACK },
  calves: { slug: 'calves', views: BOTH },
  neck: { slug: 'neck', views: BOTH },
};

export const MUSCLE_NAMES: Record<BodyMapKey, string> = {
  chest: 'Chest',
  front_delts: 'Front Delts',
  side_delts: 'Side Delts',
  rear_delts: 'Rear Delts',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  abs: 'Abs',
  obliques: 'Obliques',
  lats: 'Lats',
  upper_back: 'Upper Back',
  traps: 'Traps',
  lower_back: 'Lower Back',
  glutes: 'Glutes',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  adductors: 'Adductors',
  abductors: 'Abductors',
  calves: 'Calves',
  neck: 'Neck',
};

export const TARGET_COLORS = { primary: palette.red500, secondary: palette.red200 } as const;

/** Heat-map shades, lightest (fewest sets) to the primary red (most sets). */
export const HEAT_SCALE = ['#FBD5D6', palette.red200, '#EC6E71', palette.red500] as const;

export interface PartFill {
  slug: Slug;
  color: string;
}

/** Every region the highlighter draws, including ones we never highlight (head, hands, ...). */
export const HIGHLIGHTER_SLUGS: readonly Slug[] = [
  'abs',
  'adductors',
  'ankles',
  'biceps',
  'calves',
  'chest',
  'deltoids',
  'feet',
  'forearm',
  'gluteal',
  'hamstring',
  'hands',
  'hair',
  'head',
  'knees',
  'lower-back',
  'neck',
  'obliques',
  'quadriceps',
  'tibialis',
  'trapezius',
  'triceps',
  'upper-back',
];

/**
 * `fills` plus the neutral colour for every other region. The highlighter's male figure
 * hard-codes a dark grey on each part, which beats its `defaultFill`, so untouched regions
 * must be coloured explicitly or they look wrong on a light background.
 */
export function withNeutral(fills: readonly PartFill[], neutral: string): PartFill[] {
  const coloured = new Set(fills.map((f) => f.slug));
  return [
    ...fills,
    ...HIGHLIGHTER_SLUGS.filter((slug) => !coloured.has(slug)).map((slug) => ({
      slug,
      color: neutral,
    })),
  ];
}

export function isBodyMapKey(value: string): value is BodyMapKey {
  return Object.hasOwn(REGIONS, value);
}

/** The region for `key` if it is drawn on `view`; unknown keys (a newer server) are ignored. */
function regionOn(key: string, view: BodyView): Region | null {
  if (!isBodyMapKey(key)) return null;
  const region = REGIONS[key];
  return region.views.includes(view) ? region : null;
}

/** One fill per region, keeping the strongest when several muscles share it. */
function strongestPerSlug(entries: { slug: Slug; strength: number; color: string }[]): PartFill[] {
  const best = new Map<Slug, { strength: number; color: string }>();
  for (const entry of entries) {
    const current = best.get(entry.slug);
    if (!current || entry.strength > current.strength) best.set(entry.slug, entry);
  }
  return [...best.entries()].map(([slug, { color }]) => ({ slug, color }));
}

/** Exercise targets: primary muscles red, secondary light red; primary wins a shared region. */
export function targetFills(
  primary: readonly string[],
  secondary: readonly string[],
  view: BodyView,
  colors: { primary: string; secondary: string } = TARGET_COLORS,
): PartFill[] {
  const entries: { slug: Slug; strength: number; color: string }[] = [];
  for (const [keys, strength, color] of [
    [secondary, 1, colors.secondary],
    [primary, 2, colors.primary],
  ] as const) {
    for (const key of keys) {
      const region = regionOn(key, view);
      if (region) entries.push({ slug: region.slug, strength, color });
    }
  }
  return strongestPerSlug(entries);
}

/**
 * Heat map: each muscle's value (e.g. sets this week) picks a shade relative to the largest
 * value, so the most-trained muscle is always the full red. Zero or negative means untouched.
 */
export function heatFills(
  intensities: Readonly<Record<string, number>>,
  view: BodyView,
  scale: readonly string[] = HEAT_SCALE,
): PartFill[] {
  const values = Object.values(intensities).filter((v) => Number.isFinite(v) && v > 0);
  const max = Math.max(0, ...values);
  if (max === 0 || scale.length === 0) return [];

  const entries: { slug: Slug; strength: number; color: string }[] = [];
  for (const [key, value] of Object.entries(intensities)) {
    if (!Number.isFinite(value) || value <= 0) continue;
    const region = regionOn(key, view);
    if (!region) continue;
    const level = Math.min(scale.length, Math.max(1, Math.ceil((value / max) * scale.length)));
    entries.push({ slug: region.slug, strength: value, color: scale[level - 1] as string });
  }
  return strongestPerSlug(entries);
}

/** The figure that shows the primary muscles; the back only when none are on the front. */
export function bestView(primary: readonly string[], secondary: readonly string[] = []): BodyView {
  for (const keys of [primary, secondary]) {
    const known = keys.filter(isBodyMapKey);
    if (known.length === 0) continue;
    return known.some((key) => REGIONS[key].views.includes('front')) ? 'front' : 'back';
  }
  return 'front';
}

export function describeTargets(primary: readonly string[], secondary: readonly string[]): string {
  const names = (keys: readonly string[]) =>
    keys.filter(isBodyMapKey).map((key) => MUSCLE_NAMES[key]);
  const parts = [`Primary: ${names(primary).join(', ') || 'none'}`];
  const second = names(secondary);
  if (second.length) parts.push(`Secondary: ${second.join(', ')}`);
  return `${parts.join('. ')}.`;
}
