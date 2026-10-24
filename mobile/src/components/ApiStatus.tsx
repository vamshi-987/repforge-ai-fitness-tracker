import { StyleSheet, Text, View } from 'react-native';

import { useHealth } from '@/api/health';
import { useTheme } from '@/theme/useTheme';

/** Small badge showing whether the backend is reachable. */
export function ApiStatus() {
  const { data, isPending, isError } = useHealth();
  const { colors, radius, spacing, typography } = useTheme();

  let label = 'Checking API…';
  let dot = colors.warning;
  if (isError) {
    label = 'API unreachable';
    dot = colors.danger;
  } else if (!isPending && data) {
    label = `API connected · v${data.version}`;
    dot = colors.success;
  }

  return (
    <View
      accessibilityLabel={label}
      style={[
        styles.badge,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
          gap: spacing.sm,
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={[typography.caption, { color: colors.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
