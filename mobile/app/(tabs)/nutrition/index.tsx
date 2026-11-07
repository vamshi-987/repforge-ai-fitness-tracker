import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import type { FoodLog } from '@/api/types';
import { FoodRow } from '@/components/nutrition/FoodRow';
import { MacroBar } from '@/components/nutrition/MacroBar';
import { ProgressRing } from '@/components/ProgressRing';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { OptionSheet } from '@/components/ui/OptionSheet';
import { PromptDialog } from '@/components/ui/PromptDialog';
import { useNow } from '@/lib/useNow';
import { copyLogs, deleteLog, saveMealTemplate } from '@/nutrition/actions';
import { dayKey, dayLabel, formatAmount, isDayKey, shiftDay, totals } from '@/nutrition/rules';
import { formatMealTime } from '@/nutrition/plan';
import { NUTRITION_QUERY_KEY, useNutritionDay, useTargets } from '@/nutrition/store';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

/** One day's food against the targets, from the device, plus the meal plan. Works offline. */
export default function NutritionScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const now = useNow(60_000);
  const today = dayKey(now);
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? today;
  const data = useNutritionDay(day);
  const targets = useTargets(day).data ?? null;
  // A profile cached by an older version has no plan yet.
  const plan = useAuth((state) => state.me?.settings.meal_plan) ?? [];
  const [sheet, setSheet] = useState(false);
  const [prompt, setPrompt] = useState<'copy' | 'save' | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: NUTRITION_QUERY_KEY });
  const logs = data.data?.logs ?? [];

  function confirmRemove(log: FoodLog) {
    Alert.alert('Remove food?', `${log.name} will be removed from this day.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void deleteLog(log.id).then(refresh),
      },
    ]);
  }

  async function copyTo(toDay: string) {
    await copyLogs(logs, toDay);
    await refresh();
  }

  async function submitPrompt(text: string) {
    const value = text.trim();
    if (prompt === 'copy') {
      if (!isDayKey(value)) throw new Error('Use a date like 2026-11-05');
      await copyTo(value);
    } else {
      if (!value) throw new Error('Give it a name');
      const saved = await saveMealTemplate(value, logs);
      if (!saved) Alert.alert('Nothing to save', 'These entries aren’t linked to a food.');
      await refresh();
    }
    setPrompt(null);
  }

  const copyDays = [...new Set([today, shiftDay(day, 1)])].filter((target) => target !== day);
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
        <Button
          label="Add food"
          onPress={() => router.push({ pathname: '/nutrition/add', params: { date: day } })}
        />
        <Button
          label="Edit daily targets"
          variant="ghost"
          onPress={() => router.push('/nutrition/targets')}
        />
      </View>

      <Button
        label="Weekly report"
        variant="secondary"
        onPress={() => router.push('/coach/weekly')}
      />

      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          padding: spacing.md,
          gap: spacing.sm,
        }}
      >
        <View style={[styles.row, { gap: spacing.md }]}>
          <Text style={[typography.heading, styles.flex, { color: colors.text }]}>Meal plan</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a planned meal"
            hitSlop={8}
            onPress={() => router.push('/nutrition/plan')}
          >
            <Text style={[typography.heading, { color: colors.primary }]}>+</Text>
          </Pressable>
        </View>
        {plan.length === 0 ? (
          <Text style={[typography.body, { color: colors.textMuted }]}>
            Add your meals and their times to plan your day.
          </Text>
        ) : null}
        {plan.map((meal, index) => (
          <FoodRow
            key={`${meal.time}-${meal.name}-${index}`}
            title={meal.name}
            value={formatMealTime(meal.time)}
            accessibilityLabel={`Edit ${meal.name}`}
            onPress={() =>
              router.push({ pathname: '/nutrition/plan', params: { index: String(index) } })
            }
          />
        ))}
      </View>

      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          padding: spacing.md,
        }}
      >
        <View style={[styles.row, { gap: spacing.md }]}>
          <Text style={[typography.heading, styles.flex, { color: colors.text }]}>Food logged</Text>
          {logs.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Food logged options"
              hitSlop={8}
              onPress={() => setSheet(true)}
            >
              <Text style={[typography.heading, { color: colors.textMuted }]}>⋯</Text>
            </Pressable>
          ) : null}
        </View>
        {logs.length === 0 ? (
          <Text style={[typography.body, { color: colors.textMuted }]}>Nothing logged yet.</Text>
        ) : null}
        {logs.map((log) => (
          <View key={log.id} style={[styles.row, { gap: spacing.md }]}>
            <View style={styles.flex}>
              <FoodRow
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
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${log.name}`}
              hitSlop={8}
              onPress={() => confirmRemove(log)}
            >
              <Text style={[typography.caption, { color: colors.danger }]}>Remove</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <Text style={[typography.caption, { color: colors.textMuted }]}>
        Estimates only, not medical advice.
      </Text>

      <OptionSheet
        visible={sheet}
        title="Food logged"
        onClose={() => setSheet(false)}
        options={[
          ...copyDays.map((target) => ({
            label: `Copy to ${dayLabel(target, today).toLowerCase()}`,
            onPress: () => void copyTo(target),
          })),
          { label: 'Copy to another day', onPress: () => setPrompt('copy') },
          { label: 'Save as a meal', onPress: () => setPrompt('save') },
        ]}
      />
      <PromptDialog
        visible={prompt !== null}
        title={prompt === 'copy' ? 'Copy to another day' : 'Save as a meal'}
        label={prompt === 'copy' ? 'Date (YYYY-MM-DD)' : 'Meal name'}
        initialValue={prompt === 'copy' ? shiftDay(day, 1) : ''}
        confirmLabel={prompt === 'copy' ? 'Copy' : 'Save'}
        maxLength={prompt === 'copy' ? 10 : 80}
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
