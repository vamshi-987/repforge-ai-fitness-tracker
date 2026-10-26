import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/theme/useTheme';

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Screen-reader label when the visible text needs context, e.g. "Equipment: Barbell". */
  accessibilityLabel?: string;
}

/** A pill that toggles: filter chips and multi-select pickers. */
export function Chip({ label, selected, onPress, accessibilityLabel }: ChipProps) {
  const { colors, radius, spacing, typography } = useTheme();

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.surface,
          borderColor: selected ? colors.primary : colors.border,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs + 2,
        },
      ]}
    >
      <Text
        style={[typography.caption, styles.text, { color: selected ? '#FFFFFF' : colors.text }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1 },
  text: { fontWeight: '600' },
});
