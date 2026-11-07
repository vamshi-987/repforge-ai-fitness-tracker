import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { OptionSheet } from '@/components/ui/OptionSheet';
import { deleteRoutine, duplicateRoutine, routineError, updateRoutine } from '@/routines/actions';
import { ROUTINES_QUERY_KEY, useRoutines } from '@/routines/store';
import { exerciseSummary } from '@/routines/view';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';
import { startRoutineWorkout } from '@/workout/start';

type Busy = 'duplicate' | 'delete' | 'move' | null;

export default function RoutineDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, radius, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const routines = useRoutines();
  const defaultRest = useAuth((state) => state.me?.settings.default_rest_s ?? 90);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const routine = routines.data?.routines.find((r) => r.id === id);
  if (!routines.isSuccess) return null;
  if (!routine) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background, padding: spacing.lg }]}>
        <Stack.Screen options={{ title: 'Routine' }} />
        <Text style={[typography.body, { color: colors.textMuted }]}>
          This routine isn&apos;t on this device. It may have been deleted.
        </Text>
      </View>
    );
  }
  const folders = [...routines.data.folders].sort((a, b) => a.position - b.position);

  async function run(kind: Busy, action: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ROUTINES_QUERY_KEY });
    } catch (err) {
      setError(routineError(err));
    } finally {
      setBusy(null);
    }
  }

  const onDuplicate = () =>
    run('duplicate', async () => {
      const copy = await duplicateRoutine(routine.id);
      router.replace({ pathname: '/routine/[id]', params: { id: copy.id } });
    });

  const moveTo = (folderId: string | null) =>
    void run('move', async () => {
      await updateRoutine(routine.id, { folder_id: folderId });
    });

  const onDelete = () =>
    Alert.alert('Delete routine?', `“${routine.name}” will be deleted. Past workouts are kept.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void run('delete', async () => {
            await deleteRoutine(routine.id);
            router.back();
          }),
      },
    ]);

  const folderName = folders.find((f) => f.id === routine.folder_id)?.name;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
    >
      <Stack.Screen options={{ title: routine.name }} />

      <View style={{ gap: spacing.xs }}>
        <Text accessibilityRole="header" style={[typography.heading, { color: colors.text }]}>
          {routine.name}
        </Text>
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          {routine.exercises.length} exercise{routine.exercises.length === 1 ? '' : 's'}
          {folderName ? ` · ${folderName}` : ''}
        </Text>
        {routine.notes ? (
          <Text style={[typography.body, { color: colors.text }]}>{routine.notes}</Text>
        ) : null}
      </View>

      <View style={{ gap: spacing.sm }}>
        {routine.exercises.map((exercise, index) => (
          <View
            key={`${exercise.exercise_id}-${index}`}
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              padding: spacing.lg,
              gap: spacing.xs,
              borderLeftWidth: exercise.superset_group ? 4 : 0,
              borderLeftColor: colors.primary,
            }}
          >
            <Text style={[typography.body, styles.bold, { color: colors.text }]}>
              {exercise.exercise_name}
            </Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {exercise.superset_group ? `Superset ${exercise.superset_group} · ` : ''}
              {exerciseSummary(exercise, defaultRest)}
            </Text>
            {exercise.notes ? (
              <Text style={[typography.caption, { color: colors.text }]}>{exercise.notes}</Text>
            ) : null}
          </View>
        ))}
        {routine.exercises.length === 0 ? (
          <Text style={[typography.body, { color: colors.textMuted }]}>
            No exercises yet. Edit the routine to add some.
          </Text>
        ) : null}
      </View>

      {error ? <Text style={[typography.body, { color: colors.danger }]}>{error}</Text> : null}

      <View style={{ gap: spacing.sm }}>
        <Button label="Start routine" onPress={() => startRoutineWorkout(routine)} />
        <Button
          label="Edit routine"
          variant="secondary"
          onPress={() => router.push({ pathname: '/routine/edit', params: { id: routine.id } })}
        />
        <Button
          label="Duplicate"
          variant="secondary"
          loading={busy === 'duplicate'}
          disabled={busy !== null}
          onPress={() => void onDuplicate()}
        />
        <Button
          label="Move to folder"
          variant="secondary"
          loading={busy === 'move'}
          disabled={busy !== null}
          onPress={() => setMoving(true)}
        />
        <Button
          label="Delete routine"
          variant="ghost"
          loading={busy === 'delete'}
          disabled={busy !== null}
          onPress={onDelete}
        />
      </View>

      <OptionSheet
        visible={moving}
        title="Move to folder"
        options={[
          { label: 'No folder', selected: routine.folder_id === null, onPress: () => moveTo(null) },
          ...folders.map((folder) => ({
            label: folder.name,
            selected: routine.folder_id === folder.id,
            onPress: () => moveTo(folder.id),
          })),
        ]}
        onClose={() => setMoving(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: '600' },
});
