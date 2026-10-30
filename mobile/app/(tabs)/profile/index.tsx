import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { StatsRange } from '@/api/types';
import { BodyMap } from '@/components/BodyMap';
import { BarChart } from '@/components/charts/BarChart';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { RANGES } from '@/exercises/stats';
import { formatHeight, formatWeight } from '@/lib/units';
import {
  formatHours,
  muscleIntensities,
  useMuscleStats,
  useStatsSummary,
  WEEK_METRICS,
  weekLabels,
  weekValues,
  type WeekMetric,
} from '@/stats/dashboard';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

export default function ProfileScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const me = useAuth((state) => state.me);
  const [range, setRange] = useState<StatsRange>('3m');
  const [metric, setMetric] = useState<WeekMetric>('workouts');
  const profile = me?.profile;
  const unit = profile?.unit_weight ?? 'kg';
  const isPro = me?.is_pro ?? false;
  const locked = !isPro && (RANGES.find((r) => r.value === range)?.pro ?? false);
  const summary = useStatsSummary(range, !locked);
  const muscles = useMuscleStats(range, !locked);
  const body = [
    profile?.height_cm != null ? formatHeight(profile.height_cm, profile.unit_length) : null,
    profile?.weight_kg != null ? formatWeight(profile.weight_kg, unit) : null,
  ].filter(Boolean);
  const card = { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md };
  const muted = (text: string) => (
    <Text style={[typography.body, { color: colors.textMuted }]}>{text}</Text>
  );

  const tile = (label: string, value: string) => (
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[typography.caption, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[typography.heading, { color: colors.text }]}>{value}</Text>
    </View>
  );

  let stats;
  if (locked) stats = muted('Stats longer than 3 months are part of RepForge Pro.');
  else if (summary.isError) stats = muted('Stats need a connection. Your workouts are in History.');
  else if (!summary.isSuccess) stats = null;
  else {
    const s = summary.data;
    const values = weekValues(s.weeks, metric);
    const format = (v: number) =>
      metric === 'workouts'
        ? `${Math.round(v)}`
        : metric === 'duration'
          ? formatHours(v * 3600)
          : formatWeight(v, unit);
    const name = WEEK_METRICS.find((m) => m.value === metric)?.label ?? '';
    stats = (
      <>
        <View style={[styles.row, card]}>
          {tile('Workouts', String(s.workouts))}
          {tile('Time', formatHours(s.duration_s))}
          {tile('Volume', formatWeight(s.volume_kg, unit))}
          {tile('Streak', `${s.streak_weeks} wk`)}
        </View>
        <View style={[card, { gap: spacing.sm }]}>
          <SegmentedControl
            label="Weekly chart"
            segments={WEEK_METRICS}
            value={metric}
            onChange={setMetric}
          />
          <BarChart
            values={values}
            labels={weekLabels(s.weeks)}
            label={`${name} per week over ${s.weeks.length} weeks, this week ${format(values.at(-1) ?? 0)}`}
            formatValue={format}
          />
        </View>
      </>
    );
  }

  const trained = muscles.data?.muscles ?? [];

  return (
    <Screen title={me?.display_name ?? 'Profile'} subtitle={me ? `@${me.username}` : undefined}>
      {body.length ? (
        <Text style={[typography.body, { color: colors.text }]}>{body.join(' · ')}</Text>
      ) : null}
      <SegmentedControl
        label="Stats range"
        segments={RANGES.map((r) => ({
          value: r.value,
          label: r.pro && !isPro ? `${r.label} 🔒` : r.label,
        }))}
        value={range}
        onChange={setRange}
      />
      {stats}
      {!locked && muscles.isSuccess ? (
        <View style={[card, { gap: spacing.sm }]}>
          <Text accessibilityRole="header" style={[typography.heading, { color: colors.text }]}>
            Muscles trained
          </Text>
          {trained.length ? (
            <>
              <BodyMap
                intensities={muscleIntensities(muscles.data)}
                gender={profile?.sex === 'female' ? 'female' : 'male'}
              />
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {trained
                  .slice(0, 5)
                  .map((m) => `${m.name} ${m.sets} sets`)
                  .join(' · ')}
              </Text>
            </>
          ) : (
            muted('No sets logged in this range yet.')
          )}
        </View>
      ) : null}
      <Button label="Workout history" variant="secondary" onPress={() => router.push('/history')} />
      <Button
        label="Calendar"
        variant="secondary"
        onPress={() => router.push('/history/calendar')}
      />
      <Button label="Body" variant="secondary" onPress={() => router.push('/body')} />
      <Button label="Tools" variant="secondary" onPress={() => router.push('/tools')} />
      <Button label="Settings" variant="secondary" onPress={() => router.push('/settings')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  tile: { flex: 1, gap: 2 },
});
