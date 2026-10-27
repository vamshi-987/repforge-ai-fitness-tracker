import { usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useNow } from '@/lib/useNow';
import { useActiveWorkout } from '@/stores/activeWorkout';
import { useTheme } from '@/theme/useTheme';
import { nextSet } from '@/workout/model';
import { describeSet } from '@/workout/setValues';
import { ACTIVE_WORKOUT_PATH, openActiveWorkout } from '@/workout/start';
import { elapsedMs, formatElapsed } from '@/workout/time';

/** Pinned above the tab bar on every tab while a workout is in progress. */
export function MiniWorkoutBar() {
  const { colors, spacing, typography } = useTheme();
  const workout = useActiveWorkout((state) => state.workout);
  const pathname = usePathname();
  const now = useNow(1000, workout !== null);

  if (!workout || pathname === ACTIVE_WORKOUT_PATH) return null;
  const next = nextSet(workout);
  const elapsed = formatElapsed(elapsedMs(workout.startedAt, now));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Workout in progress: ${workout.title}, ${elapsed}. Open it.`}
      onPress={openActiveWorkout}
      style={[
        styles.bar,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
          gap: spacing.md,
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: colors.success }]} />
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[typography.body, styles.bold, { color: colors.text }]}>
          {workout.title}
        </Text>
        <Text numberOfLines={1} style={[typography.caption, { color: colors.textMuted }]}>
          {next ? `${next.exercise.name} · ${describeSet(next.label)}` : 'All sets done'}
        </Text>
      </View>
      <Text style={[typography.body, styles.clock, { color: colors.text }]}>{elapsed}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1 },
  bold: { fontWeight: '600' },
  clock: { fontVariant: ['tabular-nums'], fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
