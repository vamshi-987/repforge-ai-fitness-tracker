import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Food } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { deleteCustomFood, saveCustomFood } from '@/nutrition/actions';
import {
  readCustomFood,
  type CustomFoodErrors,
  type CustomFoodForm,
  type ServingText,
} from '@/nutrition/entry';
import { formatAmount } from '@/nutrition/rules';
import { NUTRITION_QUERY_KEY, useFood } from '@/nutrition/store';
import { useTheme } from '@/theme/useTheme';

const MAX_SERVINGS = 10;

interface Params extends Record<string, string> {
  id: string;
  name: string;
  barcode: string;
  date: string;
  meal: string;
}

function startingForm(food: Food | null, name: string, barcode: string): CustomFoodForm {
  return {
    name: food?.name ?? name,
    brand: food?.brand ?? '',
    barcode: food?.barcode ?? barcode,
    kcal: food ? formatAmount(food.kcal_100g) : '',
    protein: food ? formatAmount(food.protein_100g) : '',
    carbs: food ? formatAmount(food.carbs_100g) : '',
    fat: food ? formatAmount(food.fat_100g) : '',
    fiber: food?.fiber_100g == null ? '' : formatAmount(food.fiber_100g),
    servings: (food?.servings ?? []).map((s) => ({ label: s.label, grams: formatAmount(s.grams) })),
  };
}

const NUMBER_FIELDS = [
  { key: 'kcal', label: 'Calories per 100 g', suffix: 'kcal' },
  { key: 'protein', label: 'Protein per 100 g', suffix: 'g' },
  { key: 'carbs', label: 'Carbs per 100 g', suffix: 'g' },
  { key: 'fat', label: 'Fat per 100 g', suffix: 'g' },
  { key: 'fiber', label: 'Fiber per 100 g (optional)', suffix: 'g' },
] as const;

function Form({ food, params }: { food: Food | null; params: Partial<Params> }) {
  const { colors, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() =>
    startingForm(food, params.name ?? '', params.barcode ?? ''),
  );
  const [errors, setErrors] = useState<CustomFoodErrors>({});
  const set = (change: Partial<CustomFoodForm>) => setForm({ ...form, ...change });
  const setServing = (index: number, change: Partial<ServingText>) =>
    set({ servings: form.servings.map((s, i) => (i === index ? { ...s, ...change } : s)) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: NUTRITION_QUERY_KEY });

  async function save() {
    const result = readCustomFood(form);
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    const saved = await saveCustomFood(result.fields, food);
    await refresh();
    if (food) router.back();
    else {
      router.replace({
        pathname: '/nutrition/food/[id]',
        params: {
          id: saved.id,
          ...(params.date ? { date: params.date } : {}),
          ...(params.meal ? { meal: params.meal } : {}),
          source: 'manual',
        },
      });
    }
  }

  function confirmDelete(target: Food) {
    Alert.alert('Delete food?', `“${target.name}” will be deleted. Past logs are kept.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteCustomFood(target.id)
            .then(refresh)
            .then(() => router.dismissTo('/nutrition'));
        },
      },
    ]);
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      <TextField
        label="Name"
        value={form.name}
        onChangeText={(name) => set({ name })}
        maxLength={200}
        error={errors.name}
      />
      <TextField
        label="Brand (optional)"
        value={form.brand}
        onChangeText={(brand) => set({ brand })}
        maxLength={120}
      />
      <TextField
        label="Barcode (optional)"
        value={form.barcode}
        onChangeText={(barcode) => set({ barcode })}
        keyboardType="number-pad"
        maxLength={14}
        error={errors.barcode}
      />
      {NUMBER_FIELDS.map(({ key, label, suffix }) => (
        <TextField
          key={key}
          label={label}
          value={form[key]}
          onChangeText={(text) => set({ [key]: text })}
          keyboardType="decimal-pad"
          maxLength={6}
          suffix={suffix}
          error={errors[key]}
        />
      ))}

      <Text style={[typography.heading, { color: colors.text }]}>Servings</Text>
      {form.servings.map((serving, index) => (
        <View key={index} style={[styles.row, { gap: spacing.sm }]}>
          <View style={styles.wide}>
            <TextField
              label={`Serving ${index + 1}`}
              placeholder="1 katori"
              value={serving.label}
              onChangeText={(label) => setServing(index, { label })}
              maxLength={80}
            />
          </View>
          <View style={styles.flex}>
            <TextField
              label={`Grams in serving ${index + 1}`}
              value={serving.grams}
              onChangeText={(grams) => setServing(index, { grams })}
              keyboardType="decimal-pad"
              maxLength={6}
              suffix="g"
            />
          </View>
          <Text
            accessibilityRole="button"
            accessibilityLabel={`Remove serving ${index + 1}`}
            onPress={() => set({ servings: form.servings.filter((_, i) => i !== index) })}
            style={[typography.caption, { color: colors.danger }]}
          >
            Remove
          </Text>
        </View>
      ))}
      {errors.servings ? (
        <Text style={[typography.caption, { color: colors.danger }]}>{errors.servings}</Text>
      ) : null}
      {form.servings.length < MAX_SERVINGS ? (
        <Button
          label="Add a serving"
          variant="secondary"
          onPress={() => set({ servings: [...form.servings, { label: '', grams: '' }] })}
        />
      ) : null}

      <Button label="Save" onPress={() => void save()} />
      {food ? (
        <Button label="Delete food" variant="ghost" onPress={() => confirmDelete(food)} />
      ) : null}
    </ScrollView>
  );
}

/** Create a food (`name`/`barcode` prefill it) or change one (`id`). Past logs never change. */
export default function CustomFoodScreen() {
  const params = useLocalSearchParams<Params>();
  const food = useFood(params.id ?? null);

  if (!food.isSuccess) return null;
  return <Form food={food.data} params={params} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  flex: { flex: 1 },
  wide: { flex: 2 },
});
