import { Text, View } from 'react-native';

import type { RecordType, WeightUnit } from '@/api/types';
import { formatWeight } from '@/lib/units';
import { useTheme } from '@/theme/useTheme';
import { RECORD_NAMES, WEIGHT_RECORDS, type PersonalRecord } from '@/workout/records';

export function formatRecord(type: RecordType, value: number, unit: WeightUnit): string {
  return WEIGHT_RECORDS.has(type) ? formatWeight(value, unit) : `${value} reps`;
}

/** The personal records a workout beat: "Heaviest weight: 105 kg (was 100 kg)". */
export function RecordsCard({
  records,
  unit,
  heading,
}: {
  records: PersonalRecord[];
  unit: WeightUnit;
  heading: string;
}) {
  const { colors, radius, spacing, typography } = useTheme();
  if (records.length === 0) return null;
  return (
    <View
      accessibilityLabel={`${records.length} new personal record${records.length === 1 ? '' : 's'}`}
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.lg,
        gap: spacing.sm,
        borderColor: colors.warning,
        borderWidth: 2,
      }}
    >
      <Text style={[typography.heading, { color: colors.text }]}>🏆 {heading}</Text>
      {records.map((pr) => (
        <View key={`${pr.exerciseId}-${pr.type}`}>
          <Text style={[typography.body, { color: colors.text, fontWeight: '600' }]}>
            {pr.exerciseName}
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {RECORD_NAMES[pr.type]}: {formatRecord(pr.type, pr.value, unit)} (was{' '}
            {formatRecord(pr.type, pr.previous, unit)})
          </Text>
        </View>
      ))}
    </View>
  );
}
