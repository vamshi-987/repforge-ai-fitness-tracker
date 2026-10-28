import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { WorkoutVisibility } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { TextField } from '@/components/ui/TextField';
import { useLibrary } from '@/exercises/library';
import { formatWeight } from '@/lib/units';
import { useActiveWorkout } from '@/stores/activeWorkout';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';
import { toSavedWorkout } from '@/workout/finish';
import {
  formatClock,
  formatDurationHM,
  resolveTimes,
  type FinishTimeErrors,
} from '@/workout/finishForm';
import { HISTORY_QUERY_KEY, PREVIOUS_SETS_KEY } from '@/workout/historyStore';
import { saveFinishedWorkout } from '@/workout/saveWorkout';
import { SUMMARY_PATH } from '@/workout/start';
import type { ActiveWorkout } from '@/workout/types';

export default function FinishWorkoutScreen() {
  const workout = useActiveWorkout((state) => state.workout);
  const { colors, spacing, typography } = useTheme();

  if (!workout) {
    return (
      <SafeAreaView
        style={[
          styles.flex,
          { backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md },
        ]}
      >
        <Text style={[typography.body, { color: colors.textMuted }]}>No workout in progress.</Text>
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }
  return <FinishForm key={workout.id} workout={workout} />;
}

const VISIBILITY: { value: WorkoutVisibility; label: string }[] = [
  { value: 'public', label: 'Everyone' },
  { value: 'followers', label: 'Followers' },
  { value: 'private', label: 'Only me' },
];

function FinishForm({ workout }: { workout: ActiveWorkout }) {
  const { colors, radius, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const library = useLibrary();
  const unit = useAuth((state) => state.me?.profile.unit_weight ?? 'kg');
  const isPrivate = useAuth((state) => state.me?.is_private ?? false);
  // Pressing Finish is the end of the workout; the time spent on this screen doesn't count.
  const [endedAt] = useState(() => Date.now());
  const [title, setTitle] = useState(workout.title);
  const [notes, setNotes] = useState(workout.notes);
  const [startText, setStartText] = useState(() => formatClock(workout.startedAt));
  const [durationText, setDurationText] = useState(() =>
    formatDurationHM(endedAt - workout.startedAt),
  );
  const [visibility, setVisibility] = useState<WorkoutVisibility>(isPrivate ? 'private' : 'public');
  const [errors, setErrors] = useState<FinishTimeErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const preview = toSavedWorkout(workout, {
    title,
    notes,
    startedAt: workout.startedAt,
    endedAt,
    visibility,
  });
  const date = new Date(workout.startedAt).toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  async function save() {
    const { times, errors: problems } = resolveTimes(
      workout.startedAt,
      startText,
      durationText,
      Date.now(),
    );
    setErrors(problems);
    if (!times) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = toSavedWorkout(workout, { title, notes, visibility, ...times });
      await saveFinishedWorkout(saved, library.data?.exercises ?? []);
      await queryClient.invalidateQueries({ queryKey: [PREVIOUS_SETS_KEY] });
      await queryClient.invalidateQueries({ queryKey: HISTORY_QUERY_KEY });
      useActiveWorkout.getState().end();
      router.dismissAll();
      router.push({ pathname: SUMMARY_PATH, params: { id: saved.id } });
    } catch {
      setSaveError("Couldn't save the workout on this phone. Try again.");
      setSaving(false);
    }
  }

  const stat = (label: string, value: string) => (
    <View style={styles.flex}>
      <Text style={[typography.caption, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[typography.body, styles.bold, { color: colors.text }]}>{value}</Text>
    </View>
  );

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.flex, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>
          Finish workout
        </Text>
        <View
          style={[
            styles.row,
            { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md },
          ]}
        >
          {stat('Volume', formatWeight(preview.volumeKg, unit))}
          {stat('Sets', String(preview.setCount))}
          {stat('Exercises', String(preview.exercises.length))}
        </View>

        <TextField label="Title" value={title} onChangeText={setTitle} maxLength={80} />
        <TextField
          label="Notes"
          placeholder="How did it go?"
          value={notes}
          onChangeText={setNotes}
          multiline
          maxLength={2000}
        />
        <View style={[styles.row, { gap: spacing.md }]}>
          <View style={styles.flex}>
            <TextField
              label={`Started (${date})`}
              value={startText}
              onChangeText={setStartText}
              keyboardType="numbers-and-punctuation"
              error={errors.start}
            />
          </View>
          <View style={styles.flex}>
            <TextField
              label="Duration (h:mm)"
              value={durationText}
              onChangeText={setDurationText}
              keyboardType="numbers-and-punctuation"
              error={errors.duration}
            />
          </View>
        </View>
        <SegmentedControl
          label="Who can see it"
          segments={VISIBILITY}
          value={visibility}
          onChange={setVisibility}
        />

        {saveError ? (
          <Text style={[typography.body, { color: colors.danger }]}>{saveError}</Text>
        ) : null}
        <Button label="Save workout" loading={saving} onPress={() => void save()} />
        <Button label="Back to workout" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  bold: { fontWeight: '600' },
});
