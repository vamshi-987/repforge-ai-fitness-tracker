import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';

import type { LengthUnit, MeasurementKind } from '@/api/types';
import { deleteMeasurement, logMeasurement } from '@/body/actions';
import { BODY_QUERY_KEY, useMeasurements } from '@/body/store';
import { latestByKind } from '@/body/trend';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { TextField } from '@/components/ui/TextField';
import { cmToIn, inToCm, parseDecimal, roundTo } from '@/lib/units';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

export const KINDS: { value: MeasurementKind; label: string }[] = [
  { value: 'waist', label: 'Waist' },
  { value: 'chest', label: 'Chest' },
  { value: 'hips', label: 'Hips' },
  { value: 'neck', label: 'Neck' },
  { value: 'shoulders', label: 'Shoulders' },
  { value: 'left_arm', label: 'Left arm' },
  { value: 'right_arm', label: 'Right arm' },
  { value: 'left_thigh', label: 'Left thigh' },
  { value: 'right_thigh', label: 'Right thigh' },
  { value: 'left_calf', label: 'Left calf' },
  { value: 'right_calf', label: 'Right calf' },
  { value: 'body_fat', label: 'Body fat' },
];

const label = (kind: MeasurementKind) => KINDS.find((k) => k.value === kind)?.label ?? kind;

function format(kind: MeasurementKind, value: number, unit: LengthUnit): string {
  if (kind === 'body_fat') return `${roundTo(value, 1)}%`;
  return unit === 'cm' ? `${roundTo(value, 1)} cm` : `${roundTo(cmToIn(value), 1)} in`;
}

/** Circumferences in the user's length unit, and body fat in %. Works offline. */
export default function MeasurementsScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const unit = useAuth((state) => state.me?.profile.unit_length ?? 'cm');
  const measurements = useMeasurements();
  const [kind, setKind] = useState<MeasurementKind>('waist');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!measurements.isSuccess) return null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: BODY_QUERY_KEY });
  const latest = latestByKind(measurements.data);
  const fat = kind === 'body_fat';
  const inputUnit = fat ? '%' : unit;

  async function save() {
    const typed = parseDecimal(text);
    const value = typed === null ? null : fat || unit === 'cm' ? typed : inToCm(typed);
    const [low, high] = fat ? [2, 70] : [10, 300];
    if (value === null || value < low || value > high) {
      setError(
        fat
          ? 'Enter body fat between 2% and 70%.'
          : `Enter a value between ${format(kind, low, unit)} and ${format(kind, high, unit)}.`,
      );
      return;
    }
    setError(null);
    await logMeasurement(kind, value, Date.now());
    setText('');
    await refresh();
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {KINDS.map((k) => (
          <Chip
            key={k.value}
            label={k.label}
            selected={kind === k.value}
            onPress={() => setKind(k.value)}
          />
        ))}
      </View>
      <TextField
        label={`${label(kind)} (${inputUnit})`}
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
        error={error ?? undefined}
      />
      <Button label="Save measurement" onPress={() => void save()} />

      {latest.size ? (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            padding: spacing.md,
            gap: spacing.xs,
          }}
        >
          <Text accessibilityRole="header" style={[typography.heading, { color: colors.text }]}>
            Latest
          </Text>
          {KINDS.flatMap(({ value }) => {
            const entry = latest.get(value);
            if (!entry) return [];
            const change =
              entry.change === null || entry.change === 0
                ? ''
                : ` (${entry.change > 0 ? '+' : '−'}${format(value, Math.abs(entry.change), unit)})`;
            return [
              <Text key={value} style={[typography.body, { color: colors.text }]}>
                {label(value)}: {format(value, entry.latest.value, unit)}
                {change}
              </Text>,
            ];
          })}
        </View>
      ) : (
        <Text style={[typography.body, { color: colors.textMuted }]}>
          No measurements yet. Measure at the same time of day for comparable numbers.
        </Text>
      )}

      <View style={{ gap: spacing.xs }}>
        {measurements.data
          .filter((m) => m.kind === kind)
          .map((m) => {
            const text = `${format(m.kind, m.value, unit)} on ${new Date(
              m.measured_at,
            ).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`;
            return (
              <View key={m.id} style={{ flexDirection: 'row' }}>
                <Text style={[typography.body, { flex: 1, color: colors.text }]}>{text}</Text>
                <Text
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${label(m.kind)} ${text}`}
                  onPress={() =>
                    Alert.alert('Delete measurement?', text, [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => void deleteMeasurement(m.id).then(refresh),
                      },
                    ])
                  }
                  style={[typography.caption, { color: colors.danger }]}
                >
                  Delete
                </Text>
              </View>
            );
          })}
      </View>
    </ScrollView>
  );
}
