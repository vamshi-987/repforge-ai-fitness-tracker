import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';

interface FoodRowProps {
  title: string;
  detail: string;
  /** Right-hand figure, e.g. "320 kcal". */
  value?: string;
  accessibilityLabel?: string;
  onPress: () => void;
}

export function FoodRow({ title, detail, value, accessibilityLabel, onPress }: FoodRowProps) {
  const { colors, spacing, typography } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      style={[styles.row, { paddingVertical: spacing.sm, gap: spacing.md }]}
    >
      <View style={styles.flex}>
        <Text numberOfLines={2} style={[typography.body, { color: colors.text }]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[typography.caption, { color: colors.textMuted }]}>
          {detail}
        </Text>
      </View>
      {value ? <Text style={[typography.caption, { color: colors.text }]}>{value}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
