import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiStatus } from '@/components/ApiStatus';
import { MacroBar } from '@/components/nutrition/MacroBar';
import { Feed } from '@/components/social/Feed';
import { ProgressRing } from '@/components/ProgressRing';
import { Screen } from '@/components/Screen';
import { useNow } from '@/lib/useNow';
import { dayKey } from '@/nutrition/rules';
import { useNutritionDay, useTargets } from '@/nutrition/store';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';
import { dayStart, nextDayStart } from '@/water/rules';
import { useWaterToday } from '@/water/store';
import { useWorkoutHistory } from '@/workout/historyStore';

interface CardProps {
  label: string;
  onPress: () => void;
  children: ReactNode;
}

function Card({ label, onPress, children }: CardProps) {
  const { colors, radius, spacing } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.lg,
        gap: spacing.md,
      }}
    >
      {children}
    </Pressable>
  );
}

export default function HomeScreen() {
  const { colors, spacing, typography } = useTheme();
  const me = useAuth((state) => state.me);
  const now = useNow(60_000);
  const today = dayKey(now);
  const water = useWaterToday(me, now);
  const food = useNutritionDay(today);
  const targets = useTargets(today).data ?? null;
  const history = useWorkoutHistory();

  const kcal = Math.round(food.data?.totals.kcal ?? 0);
  const start = dayStart(now);
  const end = nextDayStart(now);
  const workouts = (history.data ?? []).filter((w) => w.startedAt >= start && w.startedAt < end);
  const sets = workouts.reduce((total, w) => total + w.setCount, 0);

  return (
    <Screen title="Home" subtitle="Today at a glance, and what your friends are lifting.">
      <Card
        label={
          targets
            ? `Calories: ${kcal} of ${targets.kcal} kcal. Open nutrition`
            : `Calories: ${kcal} kcal. Open nutrition`
        }
        onPress={() => router.navigate('/nutrition')}
      >
        <View style={[styles.row, { gap: spacing.lg }]}>
          <ProgressRing
            progress={targets ? kcal / targets.kcal : 0}
            size={84}
            stroke={10}
            label="Calories today"
          >
            <Text style={[typography.caption, { color: colors.text }]}>{kcal}</Text>
          </ProgressRing>
          <View style={{ gap: spacing.xs }}>
            <Text style={[typography.heading, { color: colors.text }]}>Calories</Text>
            <Text style={[typography.body, { color: colors.textMuted }]}>
              {targets ? `${kcal} / ${targets.kcal} kcal` : `${kcal} kcal`}
            </Text>
          </View>
        </View>
        <MacroBar
          label="Protein"
          value={food.data?.totals.protein_g ?? 0}
          target={targets?.protein_g ?? null}
        />
        <MacroBar
          label="Carbs"
          value={food.data?.totals.carbs_g ?? 0}
          target={targets?.carbs_g ?? null}
        />
        <MacroBar
          label="Fat"
          value={food.data?.totals.fat_g ?? 0}
          target={targets?.fat_g ?? null}
        />
      </Card>

      {water.isSuccess ? (
        <Card
          label={`Water: ${water.data.totalMl} of ${water.data.goalMl} ml. Open water`}
          onPress={() => router.push('/water')}
        >
          <View style={[styles.row, { gap: spacing.lg }]}>
            <ProgressRing
              progress={water.data.totalMl / water.data.goalMl}
              size={84}
              stroke={10}
              label="Water today"
            >
              <Text style={[typography.caption, { color: colors.text }]}>
                {Math.round(Math.min(1, water.data.totalMl / water.data.goalMl) * 100)}%
              </Text>
            </ProgressRing>
            <View style={{ gap: spacing.xs }}>
              <Text style={[typography.heading, { color: colors.text }]}>Water</Text>
              <Text style={[typography.body, { color: colors.textMuted }]}>
                {water.data.totalMl} / {water.data.goalMl} ml
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      <Card
        label={
          workouts.length > 0
            ? `Workout: ${workouts.length} today, ${sets} sets. Open workouts`
            : 'Workout: none yet today. Open workouts'
        }
        onPress={() => router.navigate('/workout')}
      >
        <View style={[styles.row, { gap: spacing.lg }]}>
          <ProgressRing
            progress={workouts.length > 0 ? 1 : 0}
            size={84}
            stroke={10}
            label="Workout today"
          >
            <Text style={[typography.caption, { color: colors.text }]}>
              {workouts.length > 0 ? 'Done' : 'To do'}
            </Text>
          </ProgressRing>
          <View style={[styles.flex, { gap: spacing.xs }]}>
            <Text style={[typography.heading, { color: colors.text }]}>Workout</Text>
            <Text numberOfLines={2} style={[typography.body, { color: colors.textMuted }]}>
              {workouts.length > 0
                ? `${workouts.map((w) => w.title).join(', ')} · ${sets} sets`
                : 'Nothing logged yet today'}
            </Text>
          </View>
        </View>
      </Card>

      <Text style={[typography.caption, { color: colors.textMuted }]}>
        Estimates only, not medical advice.
      </Text>
      <Feed now={now} />
      <ApiStatus />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
