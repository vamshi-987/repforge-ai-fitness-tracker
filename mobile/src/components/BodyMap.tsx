import Body from 'react-native-body-highlighter';
import { StyleSheet, View } from 'react-native';

import {
  bestView,
  describeTargets,
  heatFills,
  targetFills,
  withNeutral,
  type BodyView,
  type PartFill,
} from '@/bodymap/regions';
import { palette } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

interface CommonProps {
  /** `both` draws front and back side by side; `auto` picks the figure with the primary muscles. */
  views?: 'both' | 'auto' | BodyView;
  /** Highlighter scale; 1 is roughly 200 dp tall per figure. */
  scale?: number;
  gender?: 'male' | 'female';
  testID?: string;
}

interface TargetProps extends CommonProps {
  primary: readonly string[];
  secondary?: readonly string[];
  intensities?: never;
}

interface HeatProps extends CommonProps {
  /** Muscle key → value (e.g. sets this week). Shades are relative to the largest value. */
  intensities: Readonly<Record<string, number>>;
  primary?: never;
  secondary?: never;
}

export type BodyMapProps = TargetProps | HeatProps;

/**
 * SVG body map keyed by `muscles.body_map_key`. Exercise mode colours primary muscles red and
 * secondary ones light red; heat-map mode shades each muscle by its value.
 */
export function BodyMap(props: BodyMapProps) {
  const { views = 'both', scale = 0.6, gender = 'male', testID } = props;
  const { scheme, spacing } = useTheme();

  const isHeat = props.intensities !== undefined;
  const primary = props.primary ?? [];
  const secondary = props.secondary ?? [];
  const shown: BodyView[] =
    views === 'both'
      ? ['front', 'back']
      : [views === 'auto' ? bestView(primary, secondary) : views];

  const neutral = scheme === 'dark' ? palette.gray700 : palette.gray300;
  const fills = (view: BodyView): PartFill[] =>
    withNeutral(
      isHeat ? heatFills(props.intensities, view) : targetFills(primary, secondary, view),
      neutral,
    );

  const label = isHeat ? 'Muscles trained' : describeTargets(primary, secondary);

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[styles.row, { gap: spacing.md }]}
    >
      {shown.map((view) => (
        <View key={view} testID={testID ? `${testID}-${view}` : undefined}>
          <Body
            data={fills(view)}
            side={view}
            gender={gender}
            scale={scale}
            border="none"
            defaultFill={neutral}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start' },
});
