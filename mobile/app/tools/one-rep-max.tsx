import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { TextField } from '@/components/ui/TextField';
import { estimateOneRepMax, repTable } from '@/lib/oneRepMax';
import { parseDecimal, roundTo } from '@/lib/units';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

/** Estimated 1RM (Epley) from a set, and what that max means for other rep counts. */
export default function OneRepMaxScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const unit = useAuth((state) => state.me?.profile.unit_weight ?? 'kg');
  const [weightText, setWeightText] = useState('');
  const [repsText, setRepsText] = useState('');
  const weight = parseDecimal(weightText);
  const reps = /^\d+$/.test(repsText.trim()) ? Number(repsText.trim()) : null;
  const max = weight !== null && reps !== null ? estimateOneRepMax(weight, reps) : null;
  const show = (value: number) => `${roundTo(value, 1)} ${unit}`;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <TextField
            label={`Weight (${unit})`}
            value={weightText}
            onChangeText={setWeightText}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <TextField
            label="Reps"
            value={repsText}
            onChangeText={setRepsText}
            keyboardType="number-pad"
          />
        </View>
      </View>
      {max ? (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            padding: spacing.lg,
            gap: spacing.sm,
          }}
        >
          <Text
            accessibilityLabel={`Estimated 1RM: ${show(max.value)}`}
            style={[typography.title, { color: colors.text }]}
          >
            {show(max.value)}
          </Text>
          <Text
            style={[typography.caption, { color: max.rough ? colors.warning : colors.textMuted }]}
          >
            {max.rough
              ? 'Rough estimate: above 12 reps the formula drifts.'
              : 'Estimated one-rep max (Epley).'}
          </Text>
          {repTable(max.value).map((row) => (
            <View key={row.reps} style={{ flexDirection: 'row' }}>
              <Text style={[typography.body, { flex: 1, color: colors.textMuted }]}>
                {row.reps} rep{row.reps === 1 ? '' : 's'} · {row.percent}%
              </Text>
              <Text style={[typography.body, { color: colors.text }]}>{show(row.weight)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[typography.body, { color: colors.textMuted }]}>
          Enter a set you did, like 100 {unit} for 5 reps.
        </Text>
      )}
    </ScrollView>
  );
}
