import { router } from 'expo-router';
import { ScrollView, Text } from 'react-native';

import { Button } from '@/components/ui/Button';
import { useTheme } from '@/theme/useTheme';

/** Gym calculators; all work offline. */
export default function ToolsScreen() {
  const { colors, spacing, typography } = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      <Text style={[typography.body, { color: colors.textMuted }]}>
        Calculators for the gym floor. They work offline, in your units.
      </Text>
      <Button
        label="Plate calculator"
        variant="secondary"
        onPress={() => router.push('/tools/plates')}
      />
      <Button
        label="1RM calculator"
        variant="secondary"
        onPress={() => router.push('/tools/one-rep-max')}
      />
      <Button
        label="Warm-up sets"
        variant="secondary"
        onPress={() => router.push('/tools/warmup')}
      />
    </ScrollView>
  );
}
