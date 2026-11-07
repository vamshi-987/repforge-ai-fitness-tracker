import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { WeightUnit } from '@/api/types';
import { formatWeight } from '@/lib/units';
import { useTheme } from '@/theme/useTheme';
import type { WorkoutSummary } from '@/workout/history';
import { formatDurationWords } from '@/workout/time';

const SHOWN_EXERCISES = 3;

/** A finished workout in a list; opens its detail. */
export function WorkoutRow({ workout, unit }: { workout: WorkoutSummary; unit: WeightUnit }) {
  const { colors, radius, spacing, typography } = useTheme();
  const when = new Date(workout.startedAt).toLocaleString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const more = workout.exerciseNames.length - SHOWN_EXERCISES;
  const exercises =
    workout.exerciseNames.slice(0, SHOWN_EXERCISES).join(', ') + (more > 0 ? ` +${more} more` : '');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={workout.title}
      onPress={() => router.push({ pathname: '/history/[id]', params: { id: workout.id } })}
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        gap: spacing.xs,
      }}
    >
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Text style={[typography.body, styles.flex, styles.bold, { color: colors.text }]}>
          {workout.title}
        </Text>
        {workout.prCount ? (
          <Text style={[typography.caption, { color: colors.warning }]}>
            🏆 {workout.prCount} PR{workout.prCount === 1 ? '' : 's'}
          </Text>
        ) : null}
      </View>
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        {when} · {formatDurationWords(workout.endedAt - workout.startedAt)} ·{' '}
        {formatWeight(workout.volumeKg, unit)} · {workout.setCount} set
        {workout.setCount === 1 ? '' : 's'}
      </Text>
      {exercises ? (
        <Text style={[typography.caption, { color: colors.text }]} numberOfLines={1}>
          {exercises}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  bold: { fontWeight: '600' },
});
