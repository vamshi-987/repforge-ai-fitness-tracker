import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';

interface Segment<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  label,
  segments,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const { colors, radius, spacing, typography } = useTheme();

  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[typography.caption, { color: colors.textMuted }]}>{label}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={[
          styles.track,
          { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md },
        ]}
      >
        {segments.map((segment) => {
          const selected = segment.value === value;
          return (
            <Pressable
              key={segment.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${label}: ${segment.label}`}
              onPress={() => onChange(segment.value)}
              style={[
                styles.segment,
                {
                  backgroundColor: selected ? colors.primary : 'transparent',
                  borderRadius: radius.sm,
                  paddingVertical: spacing.sm,
                },
              ]}
            >
              <Text
                style={[
                  typography.body,
                  styles.text,
                  { color: selected ? '#FFFFFF' : colors.text },
                ]}
              >
                {segment.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', borderWidth: 1, padding: 4, gap: 4 },
  segment: { flex: 1, alignItems: 'center' },
  text: { fontWeight: '600' },
});
