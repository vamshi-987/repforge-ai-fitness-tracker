import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { WorkoutExerciseCard } from '@/components/workout/WorkoutExerciseCard';
import { exercisePicker } from '@/exercises/picker';
import { newId } from '@/lib/ids';
import { isLinkedWithNext } from '@/lib/supersets';
import { formatWeight } from '@/lib/units';
import { useNow } from '@/lib/useNow';
import { useActiveWorkout } from '@/stores/activeWorkout';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';
import { usePreviousSets } from '@/workout/historyStore';
import { addExercises, rename, workoutStats } from '@/workout/model';
import { confirmDiscard } from '@/workout/prompts';
import type { Units } from '@/workout/setValues';
import { startEmptyWorkout } from '@/workout/start';
import { elapsedMs, formatElapsed } from '@/workout/time';
import { useKeepAwakeWhileFocused } from '@/workout/useKeepAwakeWhileFocused';

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/workout');
}

/** Re-renders itself every second, so the rest of the screen doesn't. */
function ElapsedClock({ startedAt }: { startedAt: number }) {
  const { colors, typography } = useTheme();
  const now = useNow(1000);
  const text = formatElapsed(elapsedMs(startedAt, now));
  return (
    <Text
      accessibilityLabel={`Duration ${text}`}
      style={[typography.heading, styles.clock, { color: colors.text }]}
    >
      {text}
    </Text>
  );
}

export default function ActiveWorkoutScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const workout = useActiveWorkout((state) => state.workout);
  const update = useActiveWorkout((state) => state.update);
  const end = useActiveWorkout((state) => state.end);
  const me = useAuth((state) => state.me);
  const units: Units = {
    weight: me?.profile.unit_weight ?? 'kg',
    length: me?.profile.unit_length ?? 'cm',
  };
  const defaultRestS = me?.settings.default_rest_s ?? 90;
  useKeepAwakeWhileFocused(me?.settings.keep_awake ?? true);
  const previous = usePreviousSets(workout?.exercises.map((e) => e.exerciseId) ?? []);

  if (!workout) {
    return (
      <SafeAreaView
        style={[
          styles.flex,
          { backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md },
        ]}
      >
        <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>
          No workout in progress
        </Text>
        <Button label="Start empty workout" onPress={startEmptyWorkout} />
        <Button label="Back" variant="secondary" onPress={leave} />
      </SafeAreaView>
    );
  }

  const stats = workoutStats(workout);
  const addExercise = () => {
    exercisePicker.expect((picked) => update((w) => addExercises(w, picked, newId)));
    router.push('/exercise-picker');
  };
  const discard = () =>
    confirmDiscard(() => {
      end();
      leave();
    });

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
      <View
        style={[
          styles.row,
          { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.md },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Minimize workout"
          onPress={leave}
          hitSlop={12}
        >
          <Text style={[typography.heading, { color: colors.text }]}>⌄</Text>
        </Pressable>
        <View style={styles.flex}>
          <ElapsedClock startedAt={workout.startedAt} />
        </View>
      </View>

      <View
        style={[
          styles.row,
          {
            marginHorizontal: spacing.lg,
            padding: spacing.md,
            backgroundColor: colors.surface,
            borderRadius: radius.md,
          },
        ]}
      >
        {stat('Volume', formatWeight(stats.volumeKg, units.weight))}
        {stat('Sets', `${stats.completedSets} / ${stats.totalSets}`)}
        {stat('Exercises', String(workout.exercises.length))}
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: spacing.xxl * 3,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          accessibilityLabel="Workout title"
          value={workout.title}
          onChangeText={(title) => update((w) => rename(w, title))}
          maxLength={80}
          style={[typography.title, { color: colors.text }]}
        />

        {workout.exercises.map((exercise, index) => (
          <WorkoutExerciseCard
            key={exercise.id}
            exercise={exercise}
            first={index === 0}
            last={index === workout.exercises.length - 1}
            linkedWithNext={isLinkedWithNext(workout.exercises, index)}
            previous={previous.data?.[exercise.exerciseId]}
            units={units}
            defaultRestS={defaultRestS}
            newId={newId}
            onUpdate={update}
          />
        ))}
        {workout.exercises.length === 0 ? (
          <Text style={[typography.body, { color: colors.textMuted }]}>
            Add an exercise to start logging sets.
          </Text>
        ) : null}

        <Button label="Add exercises" onPress={addExercise} />
        <Button label="Discard workout" variant="ghost" onPress={discard} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  bold: { fontWeight: '600' },
  clock: { fontVariant: ['tabular-nums'] },
});
