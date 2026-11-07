import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { WaterLog } from '@/api/types';
import { BarChart } from '@/components/charts/BarChart';
import { ProgressRing } from '@/components/ProgressRing';
import { Button } from '@/components/ui/Button';
import { PromptDialog } from '@/components/ui/PromptDialog';
import { useNow } from '@/lib/useNow';
import { saveSettings } from '@/settings/actions';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';
import { addWater, removeWater } from '@/water/actions';
import { dailyTotals } from '@/water/rules';
import { HISTORY_DAYS, useWaterHistory, useWaterToday, WATER_QUERY_KEY } from '@/water/store';

const UNDO_MS = 5000;

/** Today's water against the goal, quick-add cups, undo, and the last two weeks. Offline. */
export default function WaterScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const me = useAuth((state) => state.me);
  const now = useNow(60_000);
  const today = useWaterToday(me, now);
  const history = useWaterHistory(now);
  const [undo, setUndo] = useState<WaterLog | null>(null);
  const [editing, setEditing] = useState<number | 'custom' | null>(null);
  const cups = me?.settings.water_cup_sizes ?? [250, 500, 750];

  useEffect(() => {
    if (!undo) return undefined;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: WATER_QUERY_KEY });
  const add = async (ml: number) => {
    setUndo(await addWater(ml));
    await refresh();
  };
  const remove = async (id: string) => {
    await removeWater(id);
    setUndo(null);
    await refresh();
  };

  async function submitCup(text: string) {
    const ml = Number(text.trim());
    if (!Number.isInteger(ml) || ml < 50 || ml > 2000) throw new Error('Use 50–2000 ml');
    if (editing === 'custom') await add(ml);
    else if (typeof editing === 'number')
      await saveSettings({ water_cup_sizes: cups.map((c, i) => (i === editing ? ml : c)) });
    setEditing(null);
  }

  if (!today.isSuccess) return null;
  const { totalMl, goalMl, trained, logs } = today.data;
  const left = Math.max(0, goalMl - totalMl);
  const days = dailyTotals(history.data ?? [], HISTORY_DAYS, now);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, alignItems: 'stretch' }}
    >
      <View style={{ alignItems: 'center', gap: spacing.sm }}>
        <ProgressRing
          progress={totalMl / goalMl}
          label={`Water today: ${totalMl} of ${goalMl} ml`}
          size={180}
        >
          <Text style={[typography.title, { color: colors.text }]}>{totalMl}</Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>of {goalMl} ml</Text>
        </ProgressRing>
        <Text style={[typography.body, { color: colors.text }]}>
          {left === 0 ? 'Goal reached. Reminders are done for today.' : `${left} ml to go`}
        </Text>
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          35 ml per kg{trained ? ', plus 500 ml for today’s workout' : ''}.
        </Text>
      </View>

      <View style={[styles.row, { gap: spacing.sm }]}>
        {cups.map((ml, index) => (
          <Pressable
            key={index}
            accessibilityRole="button"
            accessibilityLabel={`Add ${ml} ml`}
            accessibilityHint="Long press to change this cup"
            onPress={() => void add(ml)}
            onLongPress={() => setEditing(index)}
            style={[
              styles.cup,
              { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
            ]}
          >
            <Text style={[typography.heading, { color: colors.primary }]}>+{ml}</Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>ml</Text>
          </Pressable>
        ))}
      </View>
      <Button label="Other amount" variant="secondary" onPress={() => setEditing('custom')} />

      {undo ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.row,
            { backgroundColor: colors.text, borderRadius: radius.md, padding: spacing.md },
          ]}
        >
          <Text style={[typography.body, styles.flex, { color: colors.background }]}>
            Added {undo.amount_ml} ml
          </Text>
          <Text
            accessibilityRole="button"
            accessibilityLabel="Undo"
            onPress={() => void remove(undo.id)}
            style={[typography.body, { color: colors.primaryMuted, fontWeight: '700' }]}
          >
            Undo
          </Text>
        </View>
      ) : null}

      <View
        style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md }}
      >
        <BarChart
          values={days.map((d) => d.total)}
          labels={days.map((d, i) =>
            i % 3 === (days.length % 3) - 1 || i === days.length - 1
              ? new Date(d.day).toLocaleDateString([], { day: 'numeric', month: 'short' })
              : '',
          )}
          label={`Water over the last ${HISTORY_DAYS} days: today ${totalMl} ml`}
          formatValue={(v) => `${Math.round(v)} ml`}
        />
      </View>

      <View style={{ gap: spacing.xs }}>
        {[...logs].reverse().map((log) => {
          const time = new Date(log.logged_at).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          });
          return (
            <View key={log.id} style={styles.row}>
              <Text style={[typography.body, styles.flex, { color: colors.text }]}>
                {log.amount_ml} ml · {time}
              </Text>
              <Text
                accessibilityRole="button"
                accessibilityLabel={`Remove ${log.amount_ml} ml at ${time}`}
                onPress={() => void remove(log.id)}
                style={[typography.caption, { color: colors.danger }]}
              >
                Remove
              </Text>
            </View>
          );
        })}
      </View>

      <PromptDialog
        visible={editing !== null}
        title={editing === 'custom' ? 'Add water' : 'Change cup size'}
        label="Amount (ml)"
        initialValue={typeof editing === 'number' ? String(cups[editing] ?? '') : ''}
        confirmLabel={editing === 'custom' ? 'Add' : 'Save'}
        maxLength={4}
        onSubmit={submitCup}
        onClose={() => setEditing(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  cup: { flex: 1, alignItems: 'center' },
});
