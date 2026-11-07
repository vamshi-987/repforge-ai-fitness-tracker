import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';

export function Splash() {
  const { colors, spacing, typography } = useTheme();

  return (
    <View
      accessibilityLabel="Loading RepForge"
      style={[styles.center, { backgroundColor: colors.background, gap: spacing.md }]}
    >
      <Text style={[typography.title, { color: colors.text }]}>RepForge</Text>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
