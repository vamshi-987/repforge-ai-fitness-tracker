import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { ApiError } from '@/api/client';
import type { NutritionTargets } from '@/api/types';
import { authErrorMessage } from '@/auth/messages';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { kcalFromMacros } from '@/lib/macros';
import { useNow } from '@/lib/useNow';
import { saveTargets } from '@/nutrition/actions';
import { readTargets, type TargetsErrors, type TargetsForm } from '@/nutrition/entry';
import { dayKey, parseNumber } from '@/nutrition/rules';
import { NUTRITION_QUERY_KEY, useTargets } from '@/nutrition/store';
import { useTheme } from '@/theme/useTheme';

const FIELDS = [
  { key: 'kcal', label: 'Calories', suffix: 'kcal' },
  { key: 'protein', label: 'Protein', suffix: 'g' },
  { key: 'carbs', label: 'Carbs', suffix: 'g' },
  { key: 'fat', label: 'Fat', suffix: 'g' },
] as const;

function startingForm(targets: NutritionTargets | null): TargetsForm {
  return {
    kcal: targets ? String(targets.kcal) : '',
    protein: targets ? String(targets.protein_g) : '',
    carbs: targets ? String(targets.carbs_g) : '',
    fat: targets ? String(targets.fat_g) : '',
  };
}

function Form({ targets }: { targets: NutritionTargets | null }) {
  const { colors, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => startingForm(targets));
  const [errors, setErrors] = useState<TargetsErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fromMacros = kcalFromMacros(
    parseNumber(form.protein) ?? 0,
    parseNumber(form.carbs) ?? 0,
    parseNumber(form.fat) ?? 0,
  );

  async function save() {
    const result = readTargets(form);
    setErrors(result.errors ?? {});
    setProblem(null);
    if (result.errors) return;
    setBusy(true);
    try {
      await saveTargets(result.fields);
      await queryClient.invalidateQueries({ queryKey: NUTRITION_QUERY_KEY });
      router.back();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'target_below_safe_minimum') {
        setErrors({ kcal: cause.message });
      } else {
        setProblem(authErrorMessage(cause));
      }
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[typography.body, { color: colors.textMuted }]}>
        Your new targets start today. Past days keep theirs.
      </Text>
      {FIELDS.map(({ key, label, suffix }) => (
        <TextField
          key={key}
          label={label}
          suffix={suffix}
          value={form[key]}
          onChangeText={(text) => setForm({ ...form, [key]: text })}
          keyboardType="number-pad"
          error={errors[key]}
        />
      ))}
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        These macros add up to {Math.round(fromMacros)} kcal.
      </Text>
      {problem ? (
        <Text accessibilityRole="alert" style={[typography.body, { color: colors.danger }]}>
          {problem}
        </Text>
      ) : null}
      <Button label="Save targets" loading={busy} onPress={() => void save()} />
    </ScrollView>
  );
}

/** The calories and macros to aim for each day. */
export default function TargetsScreen() {
  const now = useNow(60_000);
  const targets = useTargets(dayKey(now));
  if (targets.isPending) return null;
  return <Form targets={targets.data ?? null} />;
}
