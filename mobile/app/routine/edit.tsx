import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { RoutineFolder, SetType, WeightUnit } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { OptionSheet } from '@/components/ui/OptionSheet';
import { Stepper } from '@/components/ui/Stepper';
import { TextField } from '@/components/ui/TextField';
import { exercisePicker } from '@/exercises/picker';
import { formatRest, stepValue } from '@/lib/format';
import { loadHeader, SET_TYPE_NAMES, SET_TYPES, setInputs, setLabels } from '@/lib/sets';
import { createRoutine, routineError, updateRoutine } from '@/routines/actions';
import {
  addExercises,
  addSet,
  draftFromRoutine,
  emptyDraft,
  hasErrors,
  isLinkedWithNext,
  MAX_SETS,
  moveExercise,
  NAME_MAX,
  removeExercise,
  removeSet,
  toggleSupersetWithNext,
  toPayload,
  updateExercise,
  updateSet,
  validateDraft,
  type DraftErrors,
  type DraftExercise,
  type RoutineDraft,
} from '@/routines/editor';
import { ROUTINES_QUERY_KEY, useRoutines } from '@/routines/store';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

const REST_STEP_S = 15;
const REST_MAX_S = 15 * 60;

export default function RoutineEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const routines = useRoutines();
  const unit = useAuth((state) => state.me?.profile.unit_weight ?? 'kg');
  if (!routines.isSuccess) return null;

  const existing = id ? routines.data.routines.find((r) => r.id === id) : undefined;
  const initial = existing ? draftFromRoutine(existing, unit) : emptyDraft();
  return (
    <RoutineEditor
      key={existing?.id ?? 'new'}
      routineId={existing?.id ?? null}
      initial={initial}
      folders={[...routines.data.folders].sort((a, b) => a.position - b.position)}
      unit={unit}
    />
  );
}

interface EditorProps {
  routineId: string | null;
  initial: RoutineDraft;
  folders: RoutineFolder[];
  unit: WeightUnit;
}

function RoutineEditor({ routineId, initial, folders, unit }: EditorProps) {
  const { colors, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const defaultRest = useAuth((state) => state.me?.settings.default_rest_s ?? 90);
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<DraftErrors>({ exercises: {} });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const openPicker = () => {
    exercisePicker.expect((picked) => setDraft((d) => addExercises(d, picked)));
    router.push('/exercise-picker');
  };

  async function save() {
    const problems = validateDraft(draft, unit);
    setErrors(problems);
    if (hasErrors(problems)) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body = toPayload(draft, unit);
      const saved = routineId ? await updateRoutine(routineId, body) : await createRoutine(body);
      await queryClient.invalidateQueries({ queryKey: ROUTINES_QUERY_KEY });
      if (routineId) router.back();
      else router.replace({ pathname: '/routine/[id]', params: { id: saved.id } });
    } catch (err) {
      setSaveError(routineError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: routineId ? 'Edit routine' : 'New routine',
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save routine"
              disabled={saving}
              onPress={() => void save()}
              hitSlop={12}
            >
              <Text style={[typography.body, styles.bold, { color: colors.primary }]}>Save</Text>
            </Pressable>
          ),
        }}
      />

      <TextField
        label="Routine name"
        placeholder="Push day"
        value={draft.name}
        onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
        maxLength={NAME_MAX}
        error={errors.name}
      />
      <TextField
        label="Notes"
        placeholder="Optional"
        value={draft.notes}
        onChangeText={(notes) => setDraft((d) => ({ ...d, notes }))}
        multiline
        maxLength={2000}
      />
      {folders.length ? (
        <View style={{ gap: spacing.xs }}>
          <Text style={[typography.caption, { color: colors.textMuted }]}>Folder</Text>
          <View style={[styles.wrap, { gap: spacing.xs }]}>
            <Chip
              label="No folder"
              selected={draft.folderId === null}
              onPress={() => setDraft((d) => ({ ...d, folderId: null }))}
            />
            {folders.map((folder) => (
              <Chip
                key={folder.id}
                label={folder.name}
                accessibilityLabel={`Folder: ${folder.name}`}
                selected={draft.folderId === folder.id}
                onPress={() => setDraft((d) => ({ ...d, folderId: folder.id }))}
              />
            ))}
          </View>
        </View>
      ) : null}

      {draft.exercises.map((exercise, index) => (
        <View key={exercise.key} style={{ gap: spacing.sm }}>
          <ExerciseCard
            exercise={exercise}
            first={index === 0}
            last={index === draft.exercises.length - 1}
            unit={unit}
            defaultRest={defaultRest}
            error={errors.exercises[exercise.key]}
            onChange={setDraft}
          />
          {index < draft.exercises.length - 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isLinkedWithNext(draft, index)
                  ? `Unlink ${exercise.name} from superset`
                  : `Superset ${exercise.name} with next`
              }
              onPress={() => setDraft((d) => toggleSupersetWithNext(d, exercise.key))}
              style={styles.center}
              hitSlop={8}
            >
              <Text style={[typography.caption, styles.bold, { color: colors.primary }]}>
                {isLinkedWithNext(draft, index)
                  ? '⛓ Superset · tap to unlink'
                  : '+ Superset with next'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      <Button label="Add exercises" variant="secondary" onPress={openPicker} />
      {saveError ? (
        <Text style={[typography.body, { color: colors.danger }]}>{saveError}</Text>
      ) : null}
      <Button label="Save routine" loading={saving} onPress={() => void save()} />
    </ScrollView>
  );
}

interface CardProps {
  exercise: DraftExercise;
  first: boolean;
  last: boolean;
  unit: WeightUnit;
  defaultRest: number;
  error: string | undefined;
  onChange: (update: (draft: RoutineDraft) => RoutineDraft) => void;
}

function ExerciseCard({ exercise, first, last, unit, defaultRest, error, onChange }: CardProps) {
  const { colors, radius, spacing, typography } = useTheme();
  const [typeFor, setTypeFor] = useState<string | null>(null);
  const inputs = setInputs(exercise.type);
  const labels = setLabels(exercise.sets.map((s) => s.setType));
  const rest = exercise.restSeconds ?? defaultRest;
  const key = exercise.key;

  const icon = (label: string, glyph: string, onPress: () => void, enabled = true) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      hitSlop={8}
      style={{ opacity: enabled ? 1 : 0.3, paddingHorizontal: spacing.xs }}
    >
      <Text style={[typography.body, { color: colors.text }]}>{glyph}</Text>
    </Pressable>
  );

  const cell = (label: string, value: string, onText: (v: string) => void, placeholder: string) => (
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={onText}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      keyboardType={placeholder.includes(':') ? 'numbers-and-punctuation' : 'decimal-pad'}
      style={[
        typography.body,
        styles.cell,
        { color: colors.text, backgroundColor: colors.background, borderRadius: radius.sm },
      ]}
    />
  );

  const typeSet = exercise.sets.find((s) => s.key === typeFor);

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.lg,
        gap: spacing.md,
        borderLeftWidth: exercise.supersetGroup ? 4 : 0,
        borderLeftColor: colors.primary,
      }}
    >
      <View style={styles.row}>
        <Text style={[typography.body, styles.bold, styles.flex, { color: colors.text }]}>
          {exercise.name}
        </Text>
        {icon(
          `Move ${exercise.name} up`,
          '▲',
          () => onChange((d) => moveExercise(d, key, -1)),
          !first,
        )}
        {icon(
          `Move ${exercise.name} down`,
          '▼',
          () => onChange((d) => moveExercise(d, key, 1)),
          !last,
        )}
        {icon(`Remove ${exercise.name}`, '✕', () => onChange((d) => removeExercise(d, key)))}
      </View>

      {inputs.reps ? (
        <View style={[styles.row, { gap: spacing.sm }]}>
          <View style={styles.flex}>
            <TextField
              label="Min reps"
              keyboardType="number-pad"
              value={exercise.repMin}
              onChangeText={(repMin) => onChange((d) => updateExercise(d, key, { repMin }))}
            />
          </View>
          <View style={styles.flex}>
            <TextField
              label="Max reps"
              keyboardType="number-pad"
              value={exercise.repMax}
              onChangeText={(repMax) => onChange((d) => updateExercise(d, key, { repMax }))}
            />
          </View>
        </View>
      ) : null}

      <View style={[styles.row, styles.between]}>
        <Text style={[typography.caption, { color: colors.textMuted }]}>Rest timer</Text>
        <Stepper
          label={`${exercise.name} rest`}
          display={
            exercise.restSeconds === null ? `${formatRest(rest)} (default)` : formatRest(rest)
          }
          canDecrement={rest > 0}
          canIncrement={rest < REST_MAX_S}
          onDecrement={() =>
            onChange((d) =>
              updateExercise(d, key, {
                restSeconds: stepValue(rest, -REST_STEP_S, 0, REST_MAX_S, REST_STEP_S),
              }),
            )
          }
          onIncrement={() =>
            onChange((d) =>
              updateExercise(d, key, {
                restSeconds: stepValue(rest, REST_STEP_S, 0, REST_MAX_S, REST_STEP_S),
              }),
            )
          }
        />
      </View>

      <View style={{ gap: spacing.xs }}>
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Text style={[typography.caption, styles.setCol, { color: colors.textMuted }]}>Set</Text>
          {inputs.load ? (
            <Text style={[typography.caption, styles.flex, { color: colors.textMuted }]}>
              {loadHeader(inputs.load, unit)}
            </Text>
          ) : null}
          {inputs.reps ? (
            <Text style={[typography.caption, styles.flex, { color: colors.textMuted }]}>Reps</Text>
          ) : null}
          {inputs.duration ? (
            <Text style={[typography.caption, styles.flex, { color: colors.textMuted }]}>Time</Text>
          ) : null}
          <View style={styles.iconCol} />
        </View>
        {exercise.sets.map((set, index) => {
          const name = `${exercise.name} set ${index + 1}`;
          const patch = (p: Parameters<typeof updateSet>[3]) =>
            onChange((d) => updateSet(d, key, set.key, p));
          return (
            <View key={set.key} style={[styles.row, { gap: spacing.sm }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${name} type: ${SET_TYPE_NAMES[set.setType]}`}
                onPress={() => setTypeFor(set.key)}
                style={styles.setCol}
              >
                <Text
                  style={[
                    typography.body,
                    styles.bold,
                    { color: set.setType === 'normal' ? colors.text : colors.primary },
                  ]}
                >
                  {labels[index]}
                </Text>
              </Pressable>
              {inputs.load ? (
                <View style={styles.flex}>
                  {cell(`${name} weight`, set.weight, (weight) => patch({ weight }), '—')}
                </View>
              ) : null}
              {inputs.reps ? (
                <View style={styles.flex}>
                  {cell(`${name} reps`, set.reps, (reps) => patch({ reps }), '—')}
                </View>
              ) : null}
              {inputs.duration ? (
                <View style={styles.flex}>
                  {cell(`${name} time`, set.duration, (duration) => patch({ duration }), '0:30')}
                </View>
              ) : null}
              <View style={styles.iconCol}>
                {icon(`Remove ${name}`, '−', () => onChange((d) => removeSet(d, key, set.key)))}
              </View>
            </View>
          );
        })}
      </View>

      <Button
        label="Add set"
        variant="ghost"
        disabled={exercise.sets.length >= MAX_SETS}
        onPress={() => onChange((d) => addSet(d, key))}
      />
      <TextField
        label="Exercise notes"
        placeholder="Optional"
        value={exercise.notes}
        onChangeText={(notes) => onChange((d) => updateExercise(d, key, { notes }))}
      />
      {error ? <Text style={[typography.caption, { color: colors.danger }]}>{error}</Text> : null}

      <OptionSheet
        visible={typeSet !== undefined}
        title="Set type"
        options={SET_TYPES.map((type: SetType) => ({
          label: SET_TYPE_NAMES[type],
          selected: typeSet?.setType === type,
          onPress: () => {
            if (typeSet) onChange((d) => updateSet(d, key, typeSet.key, { setType: type }));
          },
        }))}
        onClose={() => setTypeFor(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  between: { justifyContent: 'space-between' },
  center: { alignItems: 'center' },
  bold: { fontWeight: '600' },
  setCol: { width: 36, alignItems: 'center' },
  iconCol: { width: 28, alignItems: 'center' },
  cell: { paddingVertical: 8, paddingHorizontal: 8, textAlign: 'center' },
});
