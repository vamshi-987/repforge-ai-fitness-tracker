import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { OptionSheet, type SheetOption } from '@/components/ui/OptionSheet';
import { formatRest } from '@/lib/format';
import { loadHeader, SET_TYPE_NAMES, SET_TYPES, setInputs, setLabels } from '@/lib/sets';
import { useTheme } from '@/theme/useTheme';
import type { PreviousSet } from '@/workout/history';
import {
  addSet,
  isLoggable,
  moveExercise,
  removeExercise,
  removeSet,
  setExerciseNotes,
  toggleSupersetWithNext,
  updateSet,
} from '@/workout/model';
import {
  describeSet,
  distanceUnit,
  fillFromPrevious,
  RPE_VALUES,
  type Units,
} from '@/workout/setValues';
import type { ActiveWorkout, WorkoutExercise, WorkoutSet } from '@/workout/types';

import { SetRow } from './SetRow';

type Change = (workout: ActiveWorkout) => ActiveWorkout;

interface CardProps {
  exercise: WorkoutExercise;
  first: boolean;
  last: boolean;
  linkedWithNext: boolean;
  previous: PreviousSet[] | undefined;
  units: Units;
  defaultRestS: number;
  newId: () => string;
  onUpdate: (change: Change) => void;
  /** A set was just ticked (the rest timer starts from here). */
  onSetCompleted?: (exercise: WorkoutExercise, set: WorkoutSet) => void;
}

function missingInput(exercise: WorkoutExercise, set: WorkoutSet): string {
  const inputs = setInputs(exercise.type);
  if (inputs.distance && set.distanceM === null) return 'the distance';
  if (inputs.duration && set.durationS === null) return 'the time';
  return 'the reps';
}

export function WorkoutExerciseCard({
  exercise,
  first,
  last,
  linkedWithNext,
  previous,
  units,
  defaultRestS,
  newId,
  onUpdate,
  onSetCompleted,
}: CardProps) {
  const { colors, radius, spacing, typography } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [setMenu, setSetMenu] = useState<string | null>(null);
  const [rpeFor, setRpeFor] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const inputs = setInputs(exercise.type);
  const labels = setLabels(exercise.sets.map((s) => s.type));
  const rest = exercise.restSeconds ?? defaultRestS;
  const id = exercise.id;
  const setName = (index: number) => describeSet(labels[index] ?? String(index + 1)).toLowerCase();
  const nameOf = (index: number) => `${exercise.name} ${setName(index)}`;

  const toggle = (set: WorkoutSet, index: number) => {
    if (set.completed) {
      onUpdate((w) => updateSet(w, id, set.id, { completed: false }));
      return;
    }
    const filled = fillFromPrevious(set, previous?.[index]);
    if (!isLoggable(exercise.type, filled)) {
      setHint(`Enter ${missingInput(exercise, filled)} to complete ${setName(index)}.`);
      return;
    }
    setHint(null);
    const { weightKg, reps, durationS, distanceM } = filled;
    onUpdate((w) =>
      updateSet(w, id, set.id, { weightKg, reps, durationS, distanceM, completed: true }),
    );
    onSetCompleted?.(exercise, filled);
  };

  const copyPrevious = (set: WorkoutSet, index: number) => {
    const prev = previous?.[index];
    if (!prev) return;
    onUpdate((w) =>
      updateSet(w, id, set.id, {
        weightKg: prev.weightKg,
        reps: prev.reps,
        durationS: prev.durationS,
        distanceM: prev.distanceM,
      }),
    );
  };

  const remove = () => {
    const logged = exercise.sets.some((s) => s.completed);
    if (!logged) {
      onUpdate((w) => removeExercise(w, id));
      return;
    }
    Alert.alert('Remove exercise?', `Your logged sets of ${exercise.name} will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => onUpdate((w) => removeExercise(w, id)),
      },
    ]);
  };

  const exerciseOptions: SheetOption[] = [
    ...(first
      ? []
      : [{ label: 'Move up', onPress: () => onUpdate((w) => moveExercise(w, id, -1)) }]),
    ...(last
      ? []
      : [{ label: 'Move down', onPress: () => onUpdate((w) => moveExercise(w, id, 1)) }]),
    ...(last
      ? []
      : [
          {
            label: linkedWithNext ? 'Unlink superset with next' : 'Superset with next',
            onPress: () => onUpdate((w) => toggleSupersetWithNext(w, id)),
          },
        ]),
    { label: 'Remove exercise', destructive: true, onPress: remove },
  ];

  const menuSet = exercise.sets.find((s) => s.id === setMenu);
  const setOptions: SheetOption[] = menuSet
    ? [
        ...SET_TYPES.map((type) => ({
          label: SET_TYPE_NAMES[type],
          selected: menuSet.type === type,
          onPress: () => onUpdate((w) => updateSet(w, id, menuSet.id, { type })),
        })),
        { label: 'Rate effort (RPE)', onPress: () => setRpeFor(menuSet.id) },
        {
          label: 'Remove set',
          destructive: true,
          onPress: () => onUpdate((w) => removeSet(w, id, menuSet.id)),
        },
      ]
    : [];

  const rpeSet = exercise.sets.find((s) => s.id === rpeFor);
  const rpeOptions: SheetOption[] = rpeSet
    ? [
        ...RPE_VALUES.map((value) => ({
          label: `RPE ${value}`,
          selected: rpeSet.rpe === value,
          onPress: () => onUpdate((w) => updateSet(w, id, rpeSet.id, { rpe: value })),
        })),
        {
          label: 'No rating',
          onPress: () => onUpdate((w) => updateSet(w, id, rpeSet.id, { rpe: null })),
        },
      ]
    : [];

  const header = (text: string) => (
    <Text style={[typography.caption, styles.flex, styles.center, { color: colors.textMuted }]}>
      {text}
    </Text>
  );

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        gap: spacing.sm,
        borderLeftWidth: exercise.supersetGroup ? 4 : 0,
        borderLeftColor: colors.primary,
      }}
    >
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`About ${exercise.name}`}
          onPress={() =>
            router.push({ pathname: '/exercise/[id]', params: { id: exercise.exerciseId } })
          }
          style={styles.flex}
        >
          <Text style={[typography.body, styles.bold, { color: colors.primary }]}>
            {exercise.name}
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {exercise.supersetGroup ? `Superset ${exercise.supersetGroup} · ` : ''}
            {rest > 0 ? `Rest ${formatRest(rest)}` : 'No rest timer'}
            {exercise.repRangeMin !== null && exercise.repRangeMax !== null
              ? ` · ${exercise.repRangeMin}–${exercise.repRangeMax} reps`
              : ''}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${exercise.name} options`}
          onPress={() => setMenuOpen(true)}
          hitSlop={12}
        >
          <Text style={[typography.heading, { color: colors.textMuted }]}>⋯</Text>
        </Pressable>
      </View>

      <TextInput
        accessibilityLabel={`${exercise.name} notes`}
        value={exercise.notes}
        onChangeText={(notes) => onUpdate((w) => setExerciseNotes(w, id, notes))}
        placeholder="Add notes"
        placeholderTextColor={colors.textMuted}
        multiline
        style={[typography.caption, { color: colors.text }]}
      />

      <View style={[styles.row, { gap: spacing.xs }]}>
        <Text style={[typography.caption, styles.setCol, { color: colors.textMuted }]}>Set</Text>
        <Text style={[typography.caption, styles.prevCol, { color: colors.textMuted }]}>
          Previous
        </Text>
        {inputs.load ? header(loadHeader(inputs.load, units.weight)) : null}
        {inputs.distance ? header(distanceUnit(units.length)) : null}
        {inputs.reps ? header('Reps') : null}
        {inputs.duration ? header('Time') : null}
        <View style={styles.tickCol} />
      </View>

      {exercise.sets.map((set, index) => (
        <SetRow
          key={set.id}
          name={nameOf(index)}
          exerciseType={exercise.type}
          set={set}
          label={labels[index] ?? String(index + 1)}
          previous={previous?.[index]}
          units={units}
          onChange={(patch) => onUpdate((w) => updateSet(w, id, set.id, patch))}
          onToggle={() => toggle(set, index)}
          onOpenMenu={() => setSetMenu(set.id)}
          onUsePrevious={() => copyPrevious(set, index)}
        />
      ))}

      {hint ? <Text style={[typography.caption, { color: colors.warning }]}>{hint}</Text> : null}
      <Button
        label={`Add set to ${exercise.name}`}
        variant="ghost"
        onPress={() => onUpdate((w) => addSet(w, id, newId()))}
      />

      <OptionSheet
        visible={menuOpen}
        title={exercise.name}
        options={exerciseOptions}
        onClose={() => setMenuOpen(false)}
      />
      <OptionSheet
        visible={menuSet !== undefined}
        title={menuSet ? describeSet(labels[exercise.sets.indexOf(menuSet)] ?? '') : ''}
        options={setOptions}
        onClose={() => setSetMenu(null)}
      />
      <OptionSheet
        visible={rpeSet !== undefined}
        title="How hard was it? (RPE)"
        options={rpeOptions}
        onClose={() => setRpeFor(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  bold: { fontWeight: '600' },
  setCol: { width: 34, textAlign: 'center' },
  prevCol: { width: 84 },
  tickCol: { width: 36 },
});
