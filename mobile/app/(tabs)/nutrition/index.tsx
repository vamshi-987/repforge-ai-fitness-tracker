import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import type { FoodLog, Meal } from '@/api/types';
import { FoodRow } from '@/components/nutrition/FoodRow';
import { MacroBar } from '@/components/nutrition/MacroBar';
import { ProgressRing } from '@/components/ProgressRing';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { OptionSheet } from '@/components/ui/OptionSheet';
import { PromptDialog } from '@/components/ui/PromptDialog';
import { useNow } from '@/lib/useNow';
import { copyLogs, saveMealTemplate } from '@/nutrition/actions';
import {
  dayKey,
  dayLabel,
  formatAmount,
  isDayKey,
  MEAL_LABELS,
  MEALS,
  shiftDay,
  totals,
} from '@/nutrition/rules';
import { NUTRITION_QUERY_KEY, useNutritionDay, useTargets } from '@/nutrition/store';
import { useTheme } from '@/theme/useTheme';

/** One day of meals against the targets, from the device, so it all works offline. */
export default function NutritionScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const now = useNow(60_000);
  const today = dayKey(now);
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? today;
  const data = useNutritionDay(day);
  const targets = useTargets(day).data ?? null;
  const [sheet, setSheet] = useState<Meal | null>(null);
  const [prompt, setPrompt] = useState<{ kind: 'copy' | 'save'; meal: Meal } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: NUTRITION_QUERY_KEY });
  const mealLogs = (meal: Meal): FoodLog[] => data.data?.meals[meal] ?? [];

  async function copyTo(meal: Meal, toDay: string) {
    await copyLogs(mealLogs(meal), toDay);
    await refresh();
  }

  async function submitPrompt(text: string) {
    if (!prompt) return;
    const value = text.trim();
    if (prompt.kind === 'copy') {
      if (!isDayKey(value)) throw new Error('Use a date like 2026-11-05');
      await copyTo(prompt.meal, value);
    } else {
      if (!value) throw new Error('Give it a name');
      const saved = await saveMealTemplate(value, mealLogs(prompt.meal));
      if (!saved) Alert.alert('Nothing to save', 'These entries aren’t linked to a food.');
      await refresh();
    }
    setPrompt(null);
  }

  const copyDays = sheet
    ? [...new Set([today, shiftDay(day, 1)])].filter((target) => target !== day)
    : [];
  const total = data.data?.totals ?? totals([]);
  const left = targets ? Math.round(targets.kcal - total.kcal) : null;

  return (
    <Screen title="Nutrition">
      <View style={styles.row}>
        <Text
          accessibilityRole="button"
          accessibilityLabel="Previous day"
          onPress={() => setPicked(shiftDay(day, -1))}
          style={[typography.heading, { color: colors.primary, padding: spacing.sm }]}
        >
          ‹
        </Text>
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.heading, styles.center, { color: colors.text }]}
        >
          {dayLabel(day, today)}
        </Text>
        <Text
          accessibilityRole="button"
          accessibilityLabel="Next day"
          onPress={() => setPicked(shiftDay(day, 1))}
          style={[typography.heading, { color: colors.primary, padding: spacing.sm }]}
        >
          ›
        </Text>
      </View>

      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          padding: spacing.lg,
          gap: spacing.md,
        }}
      >
        <View style={[styles.row, { gap: spacing.lg }]}>
          <ProgressRing
            progress={targets ? total.kcal / targets.kcal : 0}
            size={96}
            stroke={10}
            label={
              targets
                ? `Calories: ${Math.round(total.kcal)} of ${targets.kcal} kcal`
                : `Calories: ${Math.round(total.kcal)} kcal`
            }
          >
            <Text style={[typography.heading, { color: colors.text }]}>
              {Math.round(total.kcal)}
            </Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>kcal</Text>
          </ProgressRing>
          <Text style={[typography.body, styles.flex, { color: colors.textMuted }]}>
            {left === null
              ? 'Finish your profile to get calorie and macro targets.'
              : left >= 0
                ? `${left} kcal left of ${targets?.kcal}`
                : `${-left} kcal over ${targets?.kcal}`}
          </Text>
        </View>
        <MacroBar label="Protein" value={total.protein_g} target={targets?.protein_g ?? null} />
        <MacroBar label="Carbs" value={total.carbs_g} target={targets?.carbs_g ?? null} />
        <MacroBar label="Fat" value={total.fat_g} target={targets?.fat_g ?? null} />
      </View>

      <Button
        label="Weekly report"
        variant="secondary"
        onPress={() => router.push('/coach/weekly')}
      />

      {MEALS.map((meal) => {
        const logs = mealLogs(meal);
        const label = MEAL_LABELS[meal];
        return (
          <View
            key={meal}
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              padding: spacing.md,
            }}
          >
            <View style={[styles.row, { gap: spacing.md }]}>
              <Text style={[typography.heading, styles.flex, { color: colors.text }]}>{label}</Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {Math.round(totals(logs).kcal)} kcal
              </Text>
              {logs.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${label} options`}
                  hitSlop={8}
                  onPress={() => setSheet(meal)}
                >
                  <Text style={[typography.heading, { color: colors.textMuted }]}>⋯</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add to ${label}`}
                hitSlop={8}
                onPress={() =>
                  router.push({ pathname: '/nutrition/add', params: { date: day, meal } })
                }
              >
                <Text style={[typography.heading, { color: colors.primary }]}>+</Text>
              </Pressable>
            </View>
            {logs.map((log) => (
              <FoodRow
                key={log.id}
                title={log.name}
                detail={[
                  `${formatAmount(log.quantity)} ${log.unit}`,
                  `P ${formatAmount(log.protein_g)}`,
                  `C ${formatAmount(log.carbs_g)}`,
                  `F ${formatAmount(log.fat_g)}`,
                ].join(' · ')}
                value={`${Math.round(log.kcal)} kcal`}
                accessibilityLabel={`Edit ${log.name}`}
                onPress={() =>
                  router.push({
                    pathname: '/nutrition/food/[id]',
                    params: { id: log.id, mode: 'edit' },
                  })
                }
              />
            ))}
          </View>
        );
      })}

      <Text style={[typography.caption, { color: colors.textMuted }]}>
        Estimates only, not medical advice.
      </Text>

      <OptionSheet
        visible={sheet !== null}
        title={sheet ? MEAL_LABELS[sheet] : ''}
        onClose={() => setSheet(null)}
        options={
          sheet
            ? [
                ...copyDays.map((target) => ({
                  label: `Copy to ${dayLabel(target, today).toLowerCase()}`,
                  onPress: () => void copyTo(sheet, target),
                })),
                {
                  label: 'Copy to another day',
                  onPress: () => setPrompt({ kind: 'copy', meal: sheet }),
                },
                {
                  label: 'Save as a meal',
                  onPress: () => setPrompt({ kind: 'save', meal: sheet }),
                },
              ]
            : []
        }
      />
      <PromptDialog
        visible={prompt !== null}
        title={prompt?.kind === 'copy' ? 'Copy to another day' : 'Save as a meal'}
        label={prompt?.kind === 'copy' ? 'Date (YYYY-MM-DD)' : 'Meal name'}
        initialValue={prompt?.kind === 'copy' ? shiftDay(day, 1) : ''}
        confirmLabel={prompt?.kind === 'copy' ? 'Copy' : 'Save'}
        maxLength={prompt?.kind === 'copy' ? 10 : 80}
        onSubmit={submitPrompt}
        onClose={() => setPrompt(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  center: { flex: 1, textAlign: 'center' },
});
