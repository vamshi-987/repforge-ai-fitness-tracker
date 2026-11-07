import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { setLabels } from '@/lib/sets';
import { useTheme } from '@/theme/useTheme';
import type { ExerciseType } from '@/api/types';
import { HISTORY_QUERY_KEY, historyRepo } from '@/workout/historyStore';
import { formatPrevious, type Units } from '@/workout/setValues';

/** Every session of this exercise on the device, newest first. Works offline. */
export function ExerciseHistory({
  exerciseId,
  type,
  units,
}: {
  exerciseId: string;
  type: ExerciseType;
  units: Units;
}) {
  const { colors, radius, spacing, typography } = useTheme();
  const sessions = useQuery({
    queryKey: [...HISTORY_QUERY_KEY, 'exercise', exerciseId],
    queryFn: () => historyRepo.exerciseSessions(exerciseId),
    networkMode: 'always',
  });
  if (!sessions.isSuccess) return null;
  if (sessions.data.length === 0) {
    return (
      <Text style={[typography.body, { color: colors.textMuted }]}>
        Your sets for this exercise will appear here once you log workouts.
      </Text>
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {sessions.data.map((session) => {
        const labels = setLabels(session.sets.map((s) => s.type));
        const date = new Date(session.startedAt).toLocaleDateString([], {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });
        return (
          <Pressable
            key={session.workoutId}
            accessibilityRole="button"
            accessibilityLabel={`${session.title}, ${date}`}
            onPress={() =>
              router.push({ pathname: '/history/[id]', params: { id: session.workoutId } })
            }
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              padding: spacing.md,
              gap: spacing.xs,
            }}
          >
            <Text style={[typography.body, styles.bold, { color: colors.text }]}>
              {session.title}
            </Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>{date}</Text>
            {session.sets.map((set, index) => (
              <Text key={set.id} style={[typography.body, { color: colors.text }]}>
                <Text style={[styles.bold, { color: colors.primary }]}>{labels[index]} </Text>
                {formatPrevious(type, set, units)}
                {set.rpe !== null ? ` @${set.rpe}` : ''}
              </Text>
            ))}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({ bold: { fontWeight: '600' } });
