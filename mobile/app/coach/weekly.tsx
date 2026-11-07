import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { applyWeeklyReport } from '@/api/coach';
import { ApiError } from '@/api/client';
import type { DailyTargets, WeeklyReport, WeekStatus } from '@/api/types';
import { WEEKLY_REPORT_KEY, useWeeklyReport } from '@/coach/store';
import { Button } from '@/components/ui/Button';
import { formatWeight } from '@/lib/units';
import { NUTRITION_QUERY_KEY } from '@/nutrition/store';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

const BADGES: Record<WeekStatus, string> = {
  on_track: 'On track',
  too_fast: 'Too fast',
  too_slow: 'Too slow',
  insufficient_data: 'Not enough data',
};

function Card({ children }: { children: React.ReactNode }) {
  const { colors, radius, spacing } = useTheme();

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.lg,
        gap: spacing.sm,
      }}
    >
      {children}
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  const { colors, typography } = useTheme();

  return (
    <View style={styles.line}>
      <Text style={[typography.body, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[typography.body, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

function macros(targets: DailyTargets): string {
  return `P ${targets.protein_g} · C ${targets.carbs_g} · F ${targets.fat_g} g`;
}

function Report({ report }: { report: WeeklyReport }) {
  const { colors, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const unit = useAuth((state) => state.me?.profile.unit_weight ?? 'kg');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { suggested_targets: suggested, current_targets: current } = report;
  const changes = suggested !== null && report.delta_kcal !== 0;

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await applyWeeklyReport(report.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: WEEKLY_REPORT_KEY }),
        queryClient.invalidateQueries({ queryKey: NUTRITION_QUERY_KEY }),
      ]);
    } catch {
      setError('The new targets couldn’t be saved. Try again when you’re online.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        Week of {report.week_start} · {BADGES[report.status]}
      </Text>
      <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>
        {report.headline}
      </Text>

      {report.check_in ? (
        <Card>
          <Text style={[typography.heading, { color: colors.text }]}>A gentle check-in</Text>
          <Text style={[typography.body, { color: colors.text }]}>
            We won’t suggest eating less this week. If this wasn’t planned, a doctor or dietitian
            can help you find a safe pace.
          </Text>
        </Card>
      ) : null}

      {report.avg_weight_kg !== null ? (
        <Card>
          <Line label="Weekly average" value={formatWeight(report.avg_weight_kg, unit)} />
          {report.change_kg !== null ? (
            <Line
              label="Change"
              value={`${report.change_kg > 0 ? '+' : ''}${formatWeight(report.change_kg, unit)} (${report.rate_pct}%)`}
            />
          ) : null}
          <Line
            label="Target pace"
            value={`${report.target_rate_min_pct}% to ${report.target_rate_max_pct}% a week`}
          />
          {report.tdee_kcal !== null ? (
            <Line
              label={report.tdee_source === 'adaptive' ? 'Burned a day' : 'Burned a day (estimate)'}
              value={`${report.tdee_kcal} kcal`}
            />
          ) : null}
        </Card>
      ) : (
        <Card>
          <Text style={[typography.body, { color: colors.text }]}>
            {report.weigh_ins} of 3 weigh-ins last week.
          </Text>
        </Card>
      )}

      {changes && suggested && current ? (
        <Card>
          <Text style={[typography.heading, { color: colors.text }]}>New targets</Text>
          <Line label="Calories" value={`${current.kcal} → ${suggested.kcal} kcal`} />
          <Text style={[typography.caption, { color: colors.textMuted }]}>{macros(suggested)}</Text>
          {report.applied ? (
            <Text style={[typography.body, { color: colors.success }]}>Applied</Text>
          ) : (
            <Button label="Apply new targets" loading={busy} onPress={() => void apply()} />
          )}
          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: colors.danger }]}
            >
              {error}
            </Text>
          ) : null}
        </Card>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        {report.tips.map((tip) => (
          <Text key={tip} style={[typography.body, { color: colors.text }]}>
            • {tip}
          </Text>
        ))}
      </View>
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        Estimates only, not medical advice.
      </Text>
    </ScrollView>
  );
}

/** Last week's weight trend and any suggested change. Targets change only on "Apply". */
export default function WeeklyReportScreen() {
  const { colors, spacing, typography } = useTheme();
  const query = useWeeklyReport();

  if (query.data) return <Report report={query.data} />;
  if (!query.isError) return null;
  const pro = query.error instanceof ApiError && query.error.code === 'pro_required';
  return (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      <Text style={[typography.body, { color: colors.text }]}>
        {pro
          ? 'The weekly report is part of RepForge Pro.'
          : 'The weekly report needs a connection.'}
      </Text>
      {pro ? <Button label="See RepForge Pro" onPress={() => router.push('/pro')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', justifyContent: 'space-between' },
});
