import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { ApiStatus } from '@/components/ApiStatus';
import { ProgressRing } from '@/components/ProgressRing';
import { Screen } from '@/components/Screen';
import { useNow } from '@/lib/useNow';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';
import { useWaterToday } from '@/water/store';

export default function HomeScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const me = useAuth((state) => state.me);
  const now = useNow(60_000);
  const water = useWaterToday(me, now);

  return (
    <Screen title="Home" subtitle="Today at a glance. Calories, macros and your feed come later.">
      {water.isSuccess ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Water: ${water.data.totalMl} of ${water.data.goalMl} ml. Open water`}
          onPress={() => router.push('/water')}
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            padding: spacing.lg,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.lg,
          }}
        >
          <ProgressRing
            progress={water.data.totalMl / water.data.goalMl}
            size={84}
            stroke={10}
            label="Water today"
          >
            <Text style={[typography.caption, { color: colors.text }]}>
              {Math.round(Math.min(1, water.data.totalMl / water.data.goalMl) * 100)}%
            </Text>
          </ProgressRing>
          <View style={{ gap: spacing.xs }}>
            <Text style={[typography.heading, { color: colors.text }]}>Water</Text>
            <Text style={[typography.body, { color: colors.textMuted }]}>
              {water.data.totalMl} / {water.data.goalMl} ml
            </Text>
          </View>
        </Pressable>
      ) : null}
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        Estimates only, not medical advice.
      </Text>
      <ApiStatus />
    </Screen>
  );
}
