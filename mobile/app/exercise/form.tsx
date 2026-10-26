import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { ChoiceList } from '@/components/ui/ChoiceList';
import { Chip } from '@/components/ui/Chip';
import { TextField } from '@/components/ui/TextField';
import { createCustomExercise, updateCustomExercise } from '@/exercises/actions';
import {
  EXERCISE_TYPES,
  MAX_SECONDARY,
  draftFrom,
  friendlyError,
  serverFieldErrors,
  toCreate,
  toggleSecondary,
  toUpdate,
  typeLabel,
  validateDraft,
  withPrimary,
  type DraftErrors,
  type ExerciseDraft,
} from '@/exercises/form';
import { LIBRARY_QUERY_KEY, useLibrary } from '@/exercises/library';
import { useTheme } from '@/theme/useTheme';

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[typography.caption, styles.label, { color: colors.textMuted }]}>{label}</Text>
      {children}
      {error ? <Text style={[typography.caption, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}

/** Create a custom exercise, or edit one (`?id=`). The type can't change once saved. */
export default function ExerciseFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { colors, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const library = useLibrary();
  const original = id ? library.data?.exercises.find((e) => e.id === id) : undefined;
  const editing = id !== undefined;

  const [draft, setDraft] = useState<ExerciseDraft | null>(null);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!library.isSuccess) return null;
  if (editing && !original?.is_custom) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background, padding: spacing.lg }]}>
        <Text style={[typography.body, { color: colors.textMuted }]}>
          Only your own exercises can be edited.
        </Text>
      </View>
    );
  }

  const current = draft ?? draftFrom(original);
  const update = (next: ExerciseDraft) => {
    setDraft(next);
    setErrors({});
  };

  async function save() {
    const problems = validateDraft(current);
    setErrors(problems);
    setFailure(null);
    if (Object.keys(problems).length) return;
    setSaving(true);
    try {
      if (original) {
        const patch = toUpdate(current, original);
        if (Object.keys(patch).length) await updateCustomExercise(original.id, patch);
      } else {
        const created = await createCustomExercise(toCreate(current));
        router.replace({ pathname: '/exercise/[id]', params: { id: created.id } });
      }
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEY });
      if (original) router.back();
    } catch (error) {
      const fieldErrors = serverFieldErrors(error);
      if (Object.keys(fieldErrors).length) setErrors(fieldErrors);
      else setFailure(friendlyError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl }}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: editing ? 'Edit exercise' : 'New exercise' }} />

      <TextField
        label="Name"
        value={current.name}
        onChangeText={(name) => update({ ...current, name })}
        error={errors.name}
        maxLength={100}
      />

      <Field label="How sets are logged" error={errors.type}>
        {original ? (
          <Text style={[typography.body, { color: colors.text }]}>
            {typeLabel(original.type)}
            <Text style={{ color: colors.textMuted }}>
              {'  '}Can&apos;t change after saving, because past sets depend on it.
            </Text>
          </Text>
        ) : (
          <ChoiceList
            choices={EXERCISE_TYPES}
            value={current.type}
            onChange={(type) => update({ ...current, type })}
          />
        )}
      </Field>

      <Field label="Equipment" error={errors.equipment}>
        <View style={[styles.wrap, { gap: spacing.xs }]}>
          {library.data.equipment.map((e) => (
            <Chip
              key={e.slug}
              label={e.name}
              accessibilityLabel={`Equipment: ${e.name}`}
              selected={current.equipment === e.slug}
              onPress={() => update({ ...current, equipment: e.slug })}
            />
          ))}
        </View>
      </Field>

      <Field label="Primary muscle" error={errors.primaryMuscle}>
        <View style={[styles.wrap, { gap: spacing.xs }]}>
          {library.data.muscles.map((m) => (
            <Chip
              key={m.slug}
              label={m.name}
              accessibilityLabel={`Primary muscle: ${m.name}`}
              selected={current.primaryMuscle === m.slug}
              onPress={() => update(withPrimary(current, m.slug))}
            />
          ))}
        </View>
      </Field>

      <Field label={`Secondary muscles (up to ${MAX_SECONDARY})`} error={errors.secondaryMuscles}>
        <View style={[styles.wrap, { gap: spacing.xs }]}>
          {library.data.muscles
            .filter((m) => m.slug !== current.primaryMuscle)
            .map((m) => (
              <Chip
                key={m.slug}
                label={m.name}
                accessibilityLabel={`Secondary muscle: ${m.name}`}
                selected={current.secondaryMuscles.includes(m.slug)}
                onPress={() => update(toggleSecondary(current, m.slug))}
              />
            ))}
        </View>
      </Field>

      <TextField
        label="Instructions (one step per line, optional)"
        value={current.instructionsText}
        onChangeText={(instructionsText) => update({ ...current, instructionsText })}
        error={errors.instructionsText}
        multiline
      />

      {failure ? (
        <Text accessibilityRole="alert" style={[typography.body, { color: colors.danger }]}>
          {failure}
        </Text>
      ) : null}

      <Button
        label={editing ? 'Save changes' : 'Create exercise'}
        loading={saving}
        onPress={() => void save()}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: { textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
