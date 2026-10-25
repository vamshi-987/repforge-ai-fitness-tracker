import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/theme/useTheme';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  testID,
}: ButtonProps) {
  const { colors, radius, spacing, typography } = useTheme();
  const inactive = disabled || loading;
  const background =
    variant === 'primary'
      ? colors.primary
      : variant === 'secondary'
        ? colors.surface
        : 'transparent';
  const foreground =
    variant === 'primary' ? '#FFFFFF' : variant === 'ghost' ? colors.primary : colors.text;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: background,
          borderRadius: radius.md,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          borderColor: variant === 'secondary' ? colors.border : 'transparent',
          opacity: inactive ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <Text style={[typography.body, styles.label, { color: foreground }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: { fontWeight: '600' },
});
