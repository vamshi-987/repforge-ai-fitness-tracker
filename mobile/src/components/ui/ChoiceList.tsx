import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface ChoiceListProps<T extends string> {
  choices: Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
}

/** Single-select list of tappable cards (a radio group). */
export function ChoiceList<T extends string>({ choices, value, onChange }: ChoiceListProps<T>) {
  const { colors, radius, spacing, typography } = useTheme();

  return (
    <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
      {choices.map((choice) => {
        const selected = choice.value === value;
        return (
          <Pressable
            key={choice.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={choice.label}
            onPress={() => onChange(choice.value)}
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: selected ? colors.primary : colors.border,
                borderRadius: radius.md,
                padding: spacing.lg,
                gap: spacing.xs,
              },
            ]}
          >
            <Text style={[typography.body, styles.label, { color: colors.text }]}>
              {choice.label}
            </Text>
            {choice.description ? (
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {choice.description}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 2 },
  label: { fontWeight: '600' },
});
