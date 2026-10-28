import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { RecordsCard } from '@/components/workout/RecordsCard';
import { setLabels } from '@/lib/sets';
import { formatWeight } from '@/lib/units';
import { useNow } from '@/lib/useNow';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';
import { HISTORY_QUERY_KEY, PREVIOUS_SETS_KEY, useSavedWorkout } from '@/workout/historyStore';
import { canEdit } from '@/workout/historyView';
import { personalRecords } from '@/workout/records';
import { deleteSavedWorkout } from '@/workout/saveWorkout';
import { formatPrevious, type Units } from '@/workout/setValues';
import { formatDurationWords } from '@/workout/time';

const VISIBILITY_NAMES = { public: 'Everyone', followers: 'Followers', private: 'Only me' };

/** One finished workout: totals, records and every set. Edit within 24 hours; delete any time. */
export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, radius, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const me = useAuth((state) => state.me);
  const now = useNow(60_000);
  const query = useSavedWorkout(id);
  const [deleting, setDeleting] = useState(false);
  const units: Units = {
    weight: me?.profile.unit_weight ?? 'kg',
    length: me?.profile.unit_length ?? 'cm',
  };

  if (!query.isSuccess) return null;
  const workout = query.data;
  if (!workout) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background, padding: spacing.lg }]}>
        <Stack.Screen options={{ title: 'Workout' }} />
        <Text style={[typography.body, { color: colors.textMuted }]}>
          This workout isn&apos;t on this device. It may have been deleted.
        </Text>
      </View>
    );
  }

  const prs = personalRecords(workout.records, workout.exercises);
  const editable = canEdit(workout.endedAt, now);
  const when = new Date(workout.startedAt).toLocaleString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const card = { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg };

  const remove = () =>
    Alert.alert('Delete workout?', `“${workout.title}” will be removed from your history.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            setDeleting(true);
            await deleteSavedWorkout(workout.id);
            await queryClient.invalidateQueries({ queryKey: HISTORY_QUERY_KEY });
            await queryClient.invalidateQueries({ queryKey: [PREVIOUS_SETS_KEY] });
            router.back();
          })(),
      },
    ]);

  const stat = (label: string, value: string) => (
    <View style={styles.flex}>
      <Text style={[typography.caption, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[typography.body, styles.bold, { color: colors.text }]}>{value}</Text>
    </View>
  );

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
    >
      <Stack.Screen options={{ title: workout.title }} />
      <View style={{ gap: spacing.xs }}>
        <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>
          {workout.title}
        </Text>
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          {when} · {VISIBILITY_NAMES[workout.visibility]}
        </Text>
        {workout.notes ? (
          <Text style={[typography.body, { color: colors.text }]}>{workout.notes}</Text>
        ) : null}
      </View>

      <View style={[styles.row, card]}>
        {stat('Duration', formatDurationWords(workout.endedAt - workout.startedAt))}
        {stat('Volume', formatWeight(workout.volumeKg, units.weight))}
        {stat('Sets', String(workout.setCount))}
      </View>

      <RecordsCard
        records={prs}
        unit={units.weight}
        heading={prs.length === 1 ? 'Personal record' : `${prs.length} personal records`}
      />

      {workout.exercises.map((exercise) => {
        const labels = setLabels(exercise.sets.map((s) => s.type));
        return (
          <View key={exercise.id} style={[card, { gap: spacing.xs }]}>
            <Text style={[typography.body, styles.bold, { color: colors.text }]}>
              {exercise.name}
            </Text>
            {exercise.notes ? (
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {exercise.notes}
              </Text>
            ) : null}
            {exercise.sets.map((set, index) => (
              <View key={set.id} style={[styles.row, { gap: spacing.md }]}>
                <Text style={[typography.body, styles.label, { color: colors.primary }]}>
                  {labels[index]}
                </Text>
                <Text style={[typography.body, styles.flex, { color: colors.text }]}>
                  {formatPrevious(exercise.type, set, units)}
                </Text>
                {set.rpe !== null ? (
                  <Text style={[typography.caption, { color: colors.textMuted }]}>
                    RPE {set.rpe}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        );
      })}

      {editable ? (
        <Button
          label="Edit workout"
          variant="secondary"
          onPress={() => router.push({ pathname: '/history/edit', params: { id: workout.id } })}
        />
      ) : (
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          Workouts can be changed for 24 hours after they end.
        </Text>
      )}
      <Button label="Delete workout" variant="ghost" loading={deleting} onPress={remove} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  bold: { fontWeight: '600' },
  label: { width: 24, fontWeight: '600' },
});
