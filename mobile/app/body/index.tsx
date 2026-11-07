import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { deleteWeight, logWeight } from '@/body/actions';
import { BODY_QUERY_KEY, useWeights } from '@/body/store';
import { MIN_WEIGH_INS, trendSeries, weeklyAverages, weekStartMs } from '@/body/trend';
import { WeightTrendChart } from '@/components/charts/WeightTrendChart';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { formatWeight, parseDecimal, weightToKg } from '@/lib/units';
import { useNow } from '@/lib/useNow';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short' });

/** Weigh-ins with the weekly-average trend. Works offline. */
export default function BodyWeightScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const unit = useAuth((state) => state.me?.profile.unit_weight ?? 'kg');
  const weights = useWeights();
  const now = useNow(60_000);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!weights.isSuccess) return null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: BODY_QUERY_KEY });
  const weeks = weeklyAverages(weights.data);
  const series = trendSeries(weights.data);
  const latest = weights.data[0];
  const thisWeek = weeks.find((w) => w.weekStart === weekStartMs(now));
  const card = { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md };
  const lastAverage = [...weeks].reverse().find((w) => w.averageKg !== null)?.averageKg;

  async function save() {
    const value = parseDecimal(text);
    const kg = value === null ? null : weightToKg(value, unit);
    if (kg === null || kg < 25 || kg > 350) {
      setError(`Enter a weight between ${formatWeight(25, unit)} and ${formatWeight(350, unit)}.`);
      return;
    }
    setError(null);
    await logWeight(kg, Date.now());
    setText('');
    await refresh();
  }

  const remove = (id: string, label: string) =>
    Alert.alert('Delete weigh-in?', label, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void deleteWeight(id).then(refresh),
      },
    ]);

  const needed = MIN_WEIGH_INS - (thisWeek?.weighIns ?? 0);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.row, { gap: spacing.md }]}>
        <View style={styles.flex}>
          <TextField
            label={`Weight (${unit})`}
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            error={error ?? undefined}
          />
        </View>
        <View style={{ paddingTop: 22 }}>
          <Button label="Log weight" onPress={() => void save()} />
        </View>
      </View>

      <View style={[card, { gap: spacing.xs }]}>
        <Text style={[typography.caption, { color: colors.textMuted }]}>This week</Text>
        <Text style={[typography.heading, { color: colors.text }]}>
          {thisWeek?.averageKg != null
            ? `${formatWeight(thisWeek.averageKg, unit)} average`
            : latest
              ? formatWeight(latest.weight_kg, unit)
              : 'No weigh-ins yet'}
        </Text>
        {thisWeek?.averageKg == null ? (
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            Log {needed} more weigh-in{needed === 1 ? '' : 's'} this week for a weekly average.
            Daily weight swings with water; the average shows the trend.
          </Text>
        ) : null}
      </View>

      {series.dots.length ? (
        <View style={card}>
          <WeightTrendChart
            dots={series.dots}
            line={series.line}
            label={`Weight trend: ${series.dots.length} weigh-ins, latest ${formatWeight(
              latest?.weight_kg ?? 0,
              unit,
            )}${lastAverage != null ? `, latest weekly average ${formatWeight(lastAverage, unit)}` : ''}`}
            formatY={(v) => formatWeight(v, unit)}
            formatX={shortDate}
          />
        </View>
      ) : null}

      {weeks.length ? (
        <View style={{ gap: spacing.xs }}>
          <Text accessibilityRole="header" style={[typography.heading, { color: colors.text }]}>
            Weekly averages
          </Text>
          {[...weeks]
            .reverse()
            .slice(0, 6)
            .map((w) => (
              <Text key={w.weekStart} style={[typography.body, { color: colors.text }]}>
                Week of {shortDate(w.weekStart)}:{' '}
                {w.averageKg !== null
                  ? `${formatWeight(w.averageKg, unit)} (${w.weighIns} weigh-ins)`
                  : `${w.weighIns} weigh-in${w.weighIns === 1 ? '' : 's'}, needs ${MIN_WEIGH_INS}`}
              </Text>
            ))}
        </View>
      ) : null}

      <View style={{ gap: spacing.xs }}>
        {weights.data.slice(0, 30).map((w) => {
          const label = `${formatWeight(w.weight_kg, unit)} on ${new Date(
            w.measured_at,
          ).toLocaleString([], {
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
          })}`;
          return (
            <Pressable
              key={w.id}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${label}`}
              onLongPress={() => remove(w.id, label)}
              style={[styles.row, { paddingVertical: spacing.xs }]}
            >
              <Text style={[typography.body, styles.flex, { color: colors.text }]}>{label}</Text>
              <Text
                onPress={() => remove(w.id, label)}
                style={[typography.caption, { color: colors.danger }]}
              >
                Delete
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Button
        label="Measurements"
        variant="secondary"
        onPress={() => router.push('/body/measurements')}
      />
      <Button
        label="Progress photos"
        variant="secondary"
        onPress={() => router.push('/body/photos')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
