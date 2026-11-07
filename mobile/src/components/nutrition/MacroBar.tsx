import { StyleSheet, Text, View } from 'react-native';

import { formatAmount } from '@/nutrition/rules';
import { useTheme } from '@/theme/useTheme';

interface MacroBarProps {
  label: string;
  value: number;
  /** Null until targets exist: the amount shows without a bar. */
  target: number | null;
}

/** Grams eaten against the day's target. */
export function MacroBar({ label, value, target }: MacroBarProps) {
  const { colors, radius, spacing, typography } = useTheme();
  const amount = formatAmount(value);
  const progress = target ? Math.min(1, value / target) : 0;

  return (
    <View
      accessible
      accessibilityLabel={target ? `${label}: ${amount} of ${target} g` : `${label}: ${amount} g`}
      style={{ gap: spacing.xs }}
    >
      <View style={styles.row}>
        <Text style={[typography.caption, { color: colors.text }]}>{label}</Text>
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          {target ? `${amount} / ${target} g` : `${amount} g`}
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.border, borderRadius: radius.pill }]}>
        <View
          style={[
            styles.fill,
            {
              backgroundColor: colors.primary,
              borderRadius: radius.pill,
              width: `${progress * 100}%`,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  track: { height: 6, overflow: 'hidden' },
  fill: { height: 6 },
});
