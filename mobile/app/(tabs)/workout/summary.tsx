import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { RecordsCard } from '@/components/workout/RecordsCard';
import { formatWeight } from '@/lib/units';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';
import { useSavedWorkout } from '@/workout/historyStore';
import { personalRecords } from '@/workout/records';
import { bestSetLabel, type Units } from '@/workout/setValues';
import { formatDurationWords } from '@/workout/time';

/** Shown right after saving: totals, new personal records, and what was done. */
export default function WorkoutSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, radius, spacing, typography } = useTheme();
  const me = useAuth((state) => state.me);
  const units: Units = {
    weight: me?.profile.unit_weight ?? 'kg',
    length: me?.profile.unit_length ?? 'cm',
  };
  const query = useSavedWorkout(id);
  const done = () => router.back();

  if (!query.isSuccess) return null;
  const workout = query.data;
  if (!workout) {
    return (
      <SafeAreaView
        style={[
          styles.flex,
          { backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md },
        ]}
      >
        <Text style={[typography.body, { color: colors.textMuted }]}>Workout not found.</Text>
        <Button label="Done" onPress={done} />
      </SafeAreaView>
    );
  }

  const prs = personalRecords(workout.records, workout.exercises);
  const when = new Date(workout.startedAt).toLocaleString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const stat = (label: string, value: string) => (
    <View style={styles.flex}>
      <Text style={[typography.caption, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[typography.body, styles.bold, { color: colors.text }]}>{value}</Text>
    </View>
  );
  const card = { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg };

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.flex, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <View style={{ gap: spacing.xs }}>
          <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>
            Workout complete
          </Text>
          <Text style={[typography.body, { color: colors.text }]}>{workout.title}</Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>{when}</Text>
        </View>

        <View style={[styles.row, card]}>
          {stat('Duration', formatDurationWords(workout.endedAt - workout.startedAt))}
          {stat('Volume', formatWeight(workout.volumeKg, units.weight))}
          {stat('Sets', String(workout.setCount))}
        </View>

        <RecordsCard
          records={prs}
          unit={units.weight}
          heading={
            prs.length === 1 ? 'New personal record!' : `${prs.length} new personal records!`
          }
        />

        <View style={{ gap: spacing.sm }}>
          {workout.exercises.map((exercise) => (
            <View key={exercise.id} style={[card, { gap: spacing.xs }]}>
              <Text style={[typography.body, styles.bold, { color: colors.text }]}>
                {exercise.name}
              </Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {exercise.sets.length} set{exercise.sets.length === 1 ? '' : 's'}
                {bestSetLabel(exercise, units) ? ` · ${bestSetLabel(exercise, units)}` : ''}
              </Text>
            </View>
          ))}
        </View>

        <Button label="Done" onPress={done} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row' },
  bold: { fontWeight: '600' },
});
