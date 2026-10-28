import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { WorkoutVisibility } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { TextField } from '@/components/ui/TextField';
import { WorkoutExerciseCard } from '@/components/workout/WorkoutExerciseCard';
import { useLibrary } from '@/exercises/library';
import { exercisePicker } from '@/exercises/picker';
import { newId } from '@/lib/ids';
import { isLinkedWithNext } from '@/lib/supersets';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';
import { toSavedWorkout } from '@/workout/finish';
import {
  formatClock,
  formatDurationHM,
  resolveTimes,
  type FinishTimeErrors,
} from '@/workout/finishForm';
import type { SavedWorkout } from '@/workout/history';
import { HISTORY_QUERY_KEY, PREVIOUS_SETS_KEY, useSavedWorkout } from '@/workout/historyStore';
import { canEdit, toDraft } from '@/workout/historyView';
import { addExercises } from '@/workout/model';
import { updateSavedWorkout } from '@/workout/saveWorkout';
import type { Units } from '@/workout/setValues';
import type { ActiveWorkout } from '@/workout/types';

const VISIBILITY: { value: WorkoutVisibility; label: string }[] = [
  { value: 'public', label: 'Everyone' },
  { value: 'followers', label: 'Followers' },
  { value: 'private', label: 'Only me' },
];

/** Change a finished workout within 24 hours of its end: details and every set. */
export default function EditWorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing, typography } = useTheme();
  const query = useSavedWorkout(id);
  if (!query.isSuccess) return null;
  if (!query.data) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background, padding: spacing.lg }]}>
        <Text style={[typography.body, { color: colors.textMuted }]}>
          This workout isn&apos;t on this device. It may have been deleted.
        </Text>
      </View>
    );
  }
  return <Editor key={query.data.id} saved={query.data} />;
}

function Editor({ saved }: { saved: SavedWorkout }) {
  const { colors, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const library = useLibrary();
  const me = useAuth((state) => state.me);
  const units: Units = {
    weight: me?.profile.unit_weight ?? 'kg',
    length: me?.profile.unit_length ?? 'cm',
  };
  const defaultRestS = me?.settings.default_rest_s ?? 90;
  const [draft, setDraft] = useState<ActiveWorkout>(() => toDraft(saved));
  const [title, setTitle] = useState(saved.title);
  const [notes, setNotes] = useState(saved.notes);
  const [startText, setStartText] = useState(() => formatClock(saved.startedAt));
  const [durationText, setDurationText] = useState(() =>
    formatDurationHM(saved.endedAt - saved.startedAt),
  );
  const [visibility, setVisibility] = useState<WorkoutVisibility>(saved.visibility);
  const [errors, setErrors] = useState<FinishTimeErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const update = (change: (workout: ActiveWorkout) => ActiveWorkout) => setDraft(change);

  function pickExercises() {
    exercisePicker.expect((picked) => setDraft((w) => addExercises(w, picked, newId)));
    router.push('/exercise-picker');
  }

  async function save() {
    const now = Date.now();
    if (!canEdit(saved.endedAt, now)) {
      setSaveError('Workouts can only be changed for 24 hours after they end.');
      return;
    }
    const { times, errors: problems } = resolveTimes(saved.startedAt, startText, durationText, now);
    setErrors(problems);
    if (!times) return;
    const next = toSavedWorkout(draft, { title, notes, visibility, ...times });
    if (next.exercises.length === 0) {
      setSaveError('Tick at least one set, or delete the workout instead.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await updateSavedWorkout(next, library.data?.exercises ?? []);
      await queryClient.invalidateQueries({ queryKey: HISTORY_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: [PREVIOUS_SETS_KEY] });
      router.back();
    } catch {
      setSaveError("Couldn't save the changes on this phone. Try again.");
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <TextField label="Title" value={title} onChangeText={setTitle} maxLength={80} />
      <TextField label="Notes" value={notes} onChangeText={setNotes} multiline maxLength={2000} />
      <View style={[styles.row, { gap: spacing.md }]}>
        <View style={styles.flex}>
          <TextField
            label="Started"
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

      <Text style={[typography.caption, { color: colors.textMuted }]}>
        Only ticked sets are kept.
      </Text>
      {draft.exercises.map((exercise, index) => (
        <WorkoutExerciseCard
          key={exercise.id}
          exercise={exercise}
          first={index === 0}
          last={index === draft.exercises.length - 1}
          linkedWithNext={isLinkedWithNext(draft.exercises, index)}
          previous={undefined}
          units={units}
          defaultRestS={defaultRestS}
          newId={newId}
          onUpdate={update}
        />
      ))}
      <Button label="Add exercises" variant="secondary" onPress={pickExercises} />

      {saveError ? (
        <Text style={[typography.body, { color: colors.danger }]}>{saveError}</Text>
      ) : null}
      <Button label="Save changes" loading={saving} onPress={() => void save()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
});
