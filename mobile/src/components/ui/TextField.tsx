import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '@/theme/useTheme';

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  /** Unit or hint shown at the right edge of the input, e.g. "kg". */
  suffix?: string;
}

export function TextField({ label, error, suffix, ...inputProps }: TextFieldProps) {
  const { colors, radius, spacing, typography } = useTheme();

  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[typography.caption, { color: colors.textMuted }]}>{label}</Text>
      <View
        style={[
          styles.row,
          {
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.border,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
          },
        ]}
      >
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.textMuted}
          style={[typography.body, styles.input, { color: colors.text }]}
          {...inputProps}
        />
        {suffix ? (
          <Text style={[typography.body, { color: colors.textMuted }]}>{suffix}</Text>
        ) : null}
      </View>
      {error ? <Text style={[typography.caption, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, minHeight: 48 },
  input: { flex: 1, paddingVertical: 12 },
});
