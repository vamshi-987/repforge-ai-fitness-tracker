import { render, screen } from '@testing-library/react-native';

import { HEAT_SCALE, TARGET_COLORS } from '@/bodymap/regions';
import { makeMe } from '@/test/helpers';
import { palette } from '@/theme/tokens';

import { BodyMap } from '../BodyMap';

/** The subset of RNTL's `toJSON()` tree this test walks. */
interface JsonNode {
  props: Record<string, unknown>;
  children: (JsonNode | string)[] | null;
}
type Json = JsonNode | JsonNode[] | null;

/**
 * Fill colours of the rendered SVG paths, by highlighter region. Native SVG nodes carry the
 * region as `name` and the colour as an opaque ARGB integer (`{payload: 0xFFE5383B}`).
 */
function fillsByRegion(
  node: Json,
  out: Record<string, Set<number>> = {},
): Record<string, Set<number>> {
  if (!node) return out;
  if (Array.isArray(node)) {
    node.forEach((child) => fillsByRegion(child, out));
    return out;
  }
  const { name, fill } = node.props as { name?: unknown; fill?: { payload?: unknown } };
  if (typeof name === 'string' && typeof fill?.payload === 'number') {
    (out[name] ??= new Set()).add(fill.payload);
  }
  (node.children ?? []).forEach((child: JsonNode | string) => {
    if (typeof child !== 'string') fillsByRegion(child, out);
  });
  return out;
}

function argb(hex: string): number {
  return parseInt(`ff${hex.slice(1)}`, 16);
}

function regionColors(): Record<string, Set<number>> {
  return fillsByRegion(screen.toJSON() as unknown as Json);
}

describe('BodyMap', () => {
  it('draws the bench press targets on front and back figures', async () => {
    await render(
      <BodyMap primary={['chest']} secondary={['front_delts', 'triceps']} testID="map" />,
    );

    expect(screen.getByTestId('map-front')).toBeOnTheScreen();
    expect(screen.getByTestId('map-back')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Primary: Chest. Secondary: Front Delts, Triceps.'),
    ).toBeOnTheScreen();

    const colors = regionColors();
    expect(colors.chest).toEqual(new Set([argb(TARGET_COLORS.primary)]));
    // Front delts light up the front figure only; the back figure's delts stay neutral.
    expect(colors.deltoids).toEqual(
      new Set([argb(TARGET_COLORS.secondary), argb(palette.gray300)]),
    );
    expect(colors.triceps).toEqual(new Set([argb(TARGET_COLORS.secondary)]));
    // Never the highlighter's built-in dark grey, even for regions we don't map.
    expect(colors.quadriceps).toEqual(new Set([argb(palette.gray300)]));
    expect(colors.head).toEqual(new Set([argb(palette.gray300)]));
  });

  it('shows one figure in auto mode, the back for a lats exercise', async () => {
    await render(<BodyMap primary={['lats']} secondary={['biceps']} views="auto" testID="map" />);

    expect(screen.getByTestId('map-back')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-front')).toBeNull();
  });

  it('renders a heat map', async () => {
    await render(<BodyMap intensities={{ quads: 10, glutes: 5 }} testID="heat" />);

    const colors = regionColors();
    expect(colors.quadriceps).toEqual(new Set([argb(HEAT_SCALE[3])]));
    expect(colors.gluteal).toEqual(new Set([argb(HEAT_SCALE[1])]));
    expect(screen.getByLabelText('Muscles trained')).toBeOnTheScreen();
  });

  it('uses the dark neutral in dark mode', async () => {
    const { useAuth } = jest.requireActual<typeof import('@/stores/auth')>('@/stores/auth');
    const me = makeMe();
    useAuth.setState({ me: { ...me, settings: { ...me.settings, theme: 'dark' } } });

    await render(<BodyMap primary={['chest']} views="front" />);

    expect(regionColors().abs).toEqual(new Set([argb(palette.gray700)]));
    useAuth.setState({ me: null });
  });

  it('matches the snapshot', async () => {
    await render(<BodyMap primary={['chest']} secondary={['triceps']} views="front" />);

    expect(screen.toJSON()).toMatchSnapshot();
  });
});
