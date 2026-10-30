import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import type { StatsRange, WeightUnit } from '@/api/types';
import { LineChart } from '@/components/charts/LineChart';
import { Chip } from '@/components/ui/Chip';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { formatRecord } from '@/components/workout/RecordsCard';
import {
  availableMetrics,
  describeSeries,
  RANGES,
  series,
  useExerciseStats,
  type MetricKey,
} from '@/exercises/stats';
import { formatWeight } from '@/lib/units';
import { useTheme } from '@/theme/useTheme';
import { RECORD_NAMES } from '@/workout/records';

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short' });

/** Progress charts for one exercise, from the server, and its all-time records. */
export function ExerciseCharts({
  exerciseId,
  unit,
  isPro,
}: {
  exerciseId: string;
  unit: WeightUnit;
  isPro: boolean;
}) {
  const { colors, radius, spacing, typography } = useTheme();
  const [range, setRange] = useState<StatsRange>('3m');
  const [picked, setPicked] = useState<MetricKey | null>(null);
  const locked = !isPro && (RANGES.find((r) => r.value === range)?.pro ?? false);
  const stats = useExerciseStats(exerciseId, range, !locked);

  const muted = (text: string) => (
    <Text style={[typography.body, { color: colors.textMuted }]}>{text}</Text>
  );

  let body;
  if (locked) {
    body = muted('Charts longer than 3 months are part of RepForge Pro.');
  } else if (stats.isError) {
    body = muted('Charts need a connection. Your sets are under History, even offline.');
  } else if (!stats.isSuccess) {
    body = null;
  } else {
    const metrics = availableMetrics(stats.data.points);
    const metric = metrics.find((m) => m.key === picked) ?? metrics[0];
    if (!metric) {
      body = muted('No sessions in this range yet.');
    } else {
      const data = series(stats.data.points, metric.key);
      const format = (v: number) =>
        metric.weight ? formatWeight(v, unit) : `${Math.round(v)} reps`;
      body = (
        <View style={{ gap: spacing.md }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {metrics.map((m) => (
                <Chip
                  key={m.key}
                  label={m.label}
                  selected={m.key === metric.key}
                  onPress={() => setPicked(m.key)}
                />
              ))}
            </View>
          </ScrollView>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg }}>
            <LineChart
              data={data}
              label={describeSeries(metric.label, data, format)}
              formatY={format}
              formatX={shortDate}
              hollow={(i) => data[i]?.rough ?? false}
            />
          </View>
          {metric.key === 'e1rm_kg' && data.some((d) => d.rough) ? (
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              Hollow points come from sets of more than 12 reps, where the estimate is rough.
            </Text>
          ) : null}
        </View>
      );
    }
  }

  return (
    <View style={{ gap: spacing.md }}>
      <SegmentedControl
        label="Chart range"
        segments={RANGES.map((r) => ({
          value: r.value,
          label: r.pro && !isPro ? `${r.label} 🔒` : r.label,
        }))}
        value={range}
        onChange={setRange}
      />
      {body}
      {stats.data?.records.length ? (
        <View style={{ gap: spacing.xs }}>
          <Text accessibilityRole="header" style={[typography.heading, { color: colors.text }]}>
            Personal records
          </Text>
          {stats.data.records.map((r) => (
            <Text key={r.record_type} style={[typography.body, { color: colors.text }]}>
              {RECORD_NAMES[r.record_type]}: {formatRecord(r.record_type, r.value, unit)} ·{' '}
              {new Date(r.achieved_at).toLocaleDateString([], {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
