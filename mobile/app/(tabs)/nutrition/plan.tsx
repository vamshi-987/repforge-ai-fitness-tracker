import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';

import type { PlannedMeal } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import {
  MAX_PLANNED_MEALS,
  readPlannedMeal,
  sortPlan,
  type PlannedMealErrors,
} from '@/nutrition/plan';
import { saveSettings } from '@/settings/actions';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

/** Add a meal to the plan, or change one (`index`). A name and a time, and nothing else. */
export default function PlannedMealScreen() {
  const { colors, spacing, typography } = useTheme();
  const { index } = useLocalSearchParams<{ index?: string }>();
  const plan = useAuth((state) => state.me?.settings.meal_plan) ?? [];
  const position = index === undefined ? null : Number(index);
  const existing = position === null ? null : (plan[position] ?? null);
  const [name, setName] = useState(existing?.name ?? '');
  const [time, setTime] = useState(existing?.time ?? '');
  const [errors, setErrors] = useState<PlannedMealErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function commit(next: PlannedMeal[]) {
    setBusy(true);
    setProblem(null);
    if (await saveSettings({ meal_plan: sortPlan(next) })) {
      router.back();
      return;
    }
    setProblem('Couldn’t save your plan. Check your connection and try again.');
    setBusy(false);
  }

  function save() {
    const result = readPlannedMeal(name, time);
    setErrors(result.errors ?? {});
    if (result.errors) return;
    if (existing) {
      void commit(plan.map((meal, i) => (i === position ? result.meal : meal)));
    } else if (plan.length >= MAX_PLANNED_MEALS) {
      setProblem(`You can plan up to ${MAX_PLANNED_MEALS} meals.`);
    } else {
      void commit([...plan, result.meal]);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <TextField
        label="Meal name"
        value={name}
        onChangeText={setName}
        maxLength={40}
        error={errors.name}
      />
      <TextField
        label="Time"
        value={time}
        onChangeText={setTime}
        placeholder="8:30 or 1:30 pm"
        maxLength={8}
        error={errors.time}
      />
      {problem ? (
        <Text accessibilityRole="alert" style={[typography.body, { color: colors.danger }]}>
          {problem}
        </Text>
      ) : null}
      <Button label="Save meal" loading={busy} onPress={save} />
      {existing ? (
        <Button
          label="Remove from plan"
          variant="ghost"
          onPress={() => void commit(plan.filter((_, i) => i !== position))}
        />
      ) : null}
    </ScrollView>
  );
}
