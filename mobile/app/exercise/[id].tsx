import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ExerciseMedia } from '@/components/ExerciseMedia';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { deleteCustomExercise, duplicateExercise } from '@/exercises/actions';
import { friendlyError, typeLabel } from '@/exercises/form';
import { LIBRARY_QUERY_KEY, useLibrary } from '@/exercises/library';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

type Section = 'about' | 'history' | 'charts';

export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, radius, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const library = useLibrary();
  const sex = useAuth((state) => state.me?.profile.sex);
  const [section, setSection] = useState<Section>('about');
  const [busy, setBusy] = useState<'duplicate' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exercise = library.data?.exercises.find((e) => e.id === id);
  if (!library.isSuccess) return null;
  if (!exercise) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background, padding: spacing.lg }]}>
        <Stack.Screen options={{ title: 'Exercise' }} />
        <Text style={[typography.body, { color: colors.textMuted }]}>
          This exercise isn&apos;t on this device. It may have been deleted.
        </Text>
      </View>
    );
  }

  const muscleName = (slug: string) =>
    library.data.muscles.find((m) => m.slug === slug)?.name ?? slug;
  const equipmentName =
    library.data.equipment.find((e) => e.slug === exercise.equipment)?.name ?? exercise.equipment;

  async function run(kind: 'duplicate' | 'delete', action: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEY });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  const onDuplicate = () =>
    run('duplicate', async () => {
      const copy = await duplicateExercise(exercise.id);
      router.replace({ pathname: '/exercise/form', params: { id: copy.id } });
    });

  const onDelete = () =>
    Alert.alert('Delete exercise?', `“${exercise.name}” will be removed from your library.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void run('delete', async () => {
            await deleteCustomExercise(exercise.id);
            router.back();
          }),
      },
    ]);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
    >
      <Stack.Screen options={{ title: exercise.name }} />

      <ExerciseMedia
        videoUrl={exercise.media_video_url}
        primary={[exercise.primary_muscle]}
        secondary={exercise.secondary_muscles}
        gender={sex === 'female' ? 'female' : 'male'}
      />

      <View style={{ gap: spacing.xs }}>
        <Text accessibilityRole="header" style={[typography.heading, { color: colors.text }]}>
          {exercise.name}
        </Text>
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          {equipmentName} · {typeLabel(exercise.type)}
          {exercise.is_custom ? ' · Custom' : ''}
        </Text>
      </View>

      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          padding: spacing.lg,
          gap: spacing.sm,
        }}
      >
        <MuscleLine
          color={colors.primary}
          label="Primary"
          names={[muscleName(exercise.primary_muscle)]}
        />
        {exercise.secondary_muscles.length ? (
          <MuscleLine
            color={colors.primaryMuted}
            label="Secondary"
            names={exercise.secondary_muscles.map(muscleName)}
          />
        ) : null}
      </View>

      <SegmentedControl
        label="Section"
        segments={[
          { value: 'about', label: 'About' },
          { value: 'history', label: 'History' },
          { value: 'charts', label: 'Charts' },
        ]}
        value={section}
        onChange={setSection}
      />

      {section === 'about' ? (
        <View style={{ gap: spacing.sm }}>
          {exercise.instructions.length ? (
            exercise.instructions.map((line, index) => (
              <View key={index} style={[styles.row, { gap: spacing.sm }]}>
                <Text style={[typography.body, styles.step, { color: colors.primary }]}>
                  {index + 1}
                </Text>
                <Text style={[typography.body, styles.flex, { color: colors.text }]}>{line}</Text>
              </View>
            ))
          ) : (
            <Text style={[typography.body, { color: colors.textMuted }]}>No instructions yet.</Text>
          )}
          {exercise.media_license ? (
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              Media: {exercise.media_license}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={[typography.body, { color: colors.textMuted }]}>
          {section === 'history'
            ? 'Your sets for this exercise will appear here once you log workouts.'
            : 'Charts of your heaviest weight, estimated 1RM and volume will appear here once you log workouts.'}
        </Text>
      )}

      {error ? (
        <Text accessibilityRole="alert" style={[typography.body, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        {exercise.is_custom ? (
          <Button
            label="Edit"
            variant="secondary"
            onPress={() => router.push({ pathname: '/exercise/form', params: { id: exercise.id } })}
          />
        ) : null}
        <Button
          label="Duplicate as custom"
          variant="secondary"
          loading={busy === 'duplicate'}
          disabled={busy !== null}
          onPress={() => void onDuplicate()}
        />
        {exercise.is_custom ? (
          <Button
            label="Delete"
            variant="ghost"
            loading={busy === 'delete'}
            disabled={busy !== null}
            onPress={onDelete}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

function MuscleLine({ color, label, names }: { color: string; label: string; names: string[] }) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View style={[styles.row, { gap: spacing.sm }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[typography.body, { color: colors.text }]}>
        <Text style={styles.bold}>{label}: </Text>
        {names.join(', ')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  step: { width: 20, fontWeight: '700' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  bold: { fontWeight: '600' },
});
