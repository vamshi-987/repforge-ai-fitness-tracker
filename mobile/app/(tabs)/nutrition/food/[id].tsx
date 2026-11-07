import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Food, FoodLog, LogSource, Meal, Per100g } from '@/api/types';
import { AmountFields } from '@/components/nutrition/AmountFields';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { TextField } from '@/components/ui/TextField';
import { useNow } from '@/lib/useNow';
import { addLog, deleteLog, updateLog } from '@/nutrition/actions';
import { formFromLog, readEntry, type EntryForm } from '@/nutrition/entry';
import {
  dayKey,
  defaultPortion,
  formatAmount,
  mealAt,
  per100g,
  unitOptions,
} from '@/nutrition/rules';
import { NUTRITION_QUERY_KEY, useFood, useLog } from '@/nutrition/store';
import { useTheme } from '@/theme/useTheme';

type Mode = 'new' | 'edit' | 'repeat';

interface Params extends Record<string, string> {
  id: string;
  mode: Mode;
  date: string;
  meal: Meal;
  source: LogSource;
}

interface EntryProps {
  mode: Mode;
  log: FoodLog | null;
  food: Food | null;
  date: string;
  meal: Meal;
  source: LogSource;
}

function startingForm(mode: Mode, log: FoodLog | null, food: Food | null): EntryForm {
  if (log && mode === 'edit') return formFromLog(log);
  if (log) return { ...formFromLog(log), macros: null, kcal: null };
  const portion = defaultPortion(food?.servings ?? []);
  return { quantity: String(portion.quantity), unit: portion.unit, macros: null, kcal: null };
}

function Entry({ mode, log, food, date, meal: initialMeal, source }: EntryProps) {
  const { colors, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => startingForm(mode, log, food));
  // Kept for the server, which files each log under one; the app doesn't ask or show it.
  const meal = log && mode === 'edit' ? log.meal : initialMeal;
  const [showError, setShowError] = useState(false);

  // A saved log keeps its snapshot; a new one takes the food's current values.
  const snapshot: Per100g | null = mode === 'edit' ? (log?.per_100g ?? null) : null;
  const values: Per100g = snapshot ?? (food ? per100g(food) : (log as FoodLog).per_100g);
  const name = mode === 'edit' || !food ? (log as FoodLog).name : food.name;
  const brand = mode === 'edit' || !food ? (log?.brand ?? null) : food.brand;
  const units = unitOptions(
    food?.servings ?? [],
    log ? { label: log.unit, grams: log.grams / log.quantity } : undefined,
  );
  const entry = readEntry(form, units, values);
  const { amounts } = entry;
  const edited = amounts.macros_overridden || amounts.kcal_overridden;

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: NUTRITION_QUERY_KEY });
    router.dismissTo('/nutrition');
  };

  async function save() {
    if (entry.error) {
      setShowError(true);
      return;
    }
    const { quantity, unit, grams, macros, kcal } = entry;
    if (mode === 'edit' && log) {
      await updateLog(log, { meal, quantity, unit, grams, macros, kcal });
    } else {
      await addLog({
        log_date: date,
        meal,
        food_id: food?.id ?? log?.food_id ?? null,
        name,
        brand,
        per_100g: values,
        quantity,
        unit,
        grams,
        macros,
        kcal,
        source: mode === 'repeat' ? 'recent' : source,
      });
    }
    await done();
  }

  async function remove() {
    if (!log) return;
    await deleteLog(log.id);
    await done();
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      <View style={{ gap: spacing.xs }}>
        <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>
          {name}
        </Text>
        {brand ? <Text style={[typography.body, { color: colors.textMuted }]}>{brand}</Text> : null}
      </View>

      <TextField
        label="Amount"
        value={form.quantity}
        onChangeText={(quantity) => setForm({ ...form, quantity })}
        keyboardType="decimal-pad"
        maxLength={8}
        suffix={form.unit}
        error={showError ? entry.error : null}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[styles.row, { gap: spacing.xs }]}>
          {units.map((option) => (
            <Chip
              key={option.label}
              label={option.label}
              accessibilityLabel={`Unit: ${option.label}`}
              selected={option.label === form.unit}
              onPress={() => setForm({ ...form, unit: option.label })}
            />
          ))}
        </View>
      </ScrollView>
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        {formatAmount(entry.grams)} g
      </Text>

      <AmountFields form={form} amounts={amounts} onChange={setForm} />
      {edited ? (
        <Button
          label="Use the food’s values"
          variant="ghost"
          onPress={() => setForm({ ...form, macros: null, kcal: null })}
        />
      ) : null}

      <Button label={mode === 'edit' ? 'Save' : 'Add food'} onPress={() => void save()} />
      {food?.is_custom ? (
        <Button
          label="Edit this food"
          variant="secondary"
          onPress={() => router.push({ pathname: '/nutrition/custom', params: { id: food.id } })}
        />
      ) : null}
      {mode === 'edit' ? (
        <Button label="Remove from log" variant="ghost" onPress={() => void remove()} />
      ) : null}
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        Estimates only, not medical advice.
      </Text>
    </ScrollView>
  );
}

/**
 * Log a food (`id` is the food), change a log (`mode=edit`, `id` is the log), or log the same
 * thing again from Recent (`mode=repeat`, `id` is the earlier log).
 */
export default function FoodEntryScreen() {
  const { colors, spacing, typography } = useTheme();
  const { id, mode = 'new', date, meal, source = 'search' } = useLocalSearchParams<Params>();
  const now = useNow(60_000);
  const fromLog = mode !== 'new';
  const log = useLog(fromLog ? id : null);
  const food = useFood(fromLog ? (log.data?.food_id ?? null) : id);

  if (!log.isSuccess || !food.isSuccess) return null;
  if (fromLog ? !log.data : !food.data) {
    return (
      <View style={{ padding: spacing.lg }}>
        <Text style={[typography.body, { color: colors.textMuted }]}>
          This entry is no longer here.
        </Text>
      </View>
    );
  }
  return (
    <Entry
      mode={mode}
      log={log.data}
      food={food.data}
      date={date ?? dayKey(now)}
      meal={meal ?? mealAt(now)}
      source={source}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
