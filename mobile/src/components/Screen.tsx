import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/useTheme';

interface ScreenProps {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

export function Screen({ title, subtitle, children }: ScreenProps) {
  const { colors, spacing, typography } = useTheme();

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.flex, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={{ gap: spacing.xs }}>
          <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[typography.body, { color: colors.textMuted }]}>{subtitle}</Text>
          ) : null}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
