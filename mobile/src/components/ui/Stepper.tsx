import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';

interface StepperProps {
  label: string;
  /** Rendered value, e.g. "1:30". */
  display: string;
  onDecrement: () => void;
  onIncrement: () => void;
  canDecrement: boolean;
  canIncrement: boolean;
}

export function Stepper({
  label,
  display,
  onDecrement,
  onIncrement,
  canDecrement,
  canIncrement,
}: StepperProps) {
  const { colors, radius, spacing, typography } = useTheme();
  const button = (sign: '−' | '+', onPress: () => void, enabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${sign === '+' ? 'Increase' : 'Decrease'} ${label}`}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={[
        styles.button,
        {
          borderColor: colors.border,
          borderRadius: radius.sm,
          opacity: enabled ? 1 : 0.4,
        },
      ]}
    >
      <Text style={[typography.heading, { color: colors.text }]}>{sign}</Text>
    </Pressable>
  );

  return (
    <View style={[styles.row, { gap: spacing.md }]}>
      {button('−', onDecrement, canDecrement)}
      <Text
        accessibilityLabel={`${label}: ${display}`}
        style={[typography.body, styles.value, { color: colors.text }]}
      >
        {display}
      </Text>
      {button('+', onIncrement, canIncrement)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  button: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  value: { minWidth: 48, textAlign: 'center', fontWeight: '600' },
});
