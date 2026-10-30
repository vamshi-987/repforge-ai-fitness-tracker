import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { BarPicker } from '@/components/tools/BarPicker';
import { TextField } from '@/components/ui/TextField';
import { BARS, describePlates, loadBar, PLATES } from '@/lib/plates';
import { parseDecimal } from '@/lib/units';
import { warmupSets } from '@/lib/warmup';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

/** Warm-up sets that ramp up to a working weight, with the plates for each. */
export default function WarmupScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const unit = useAuth((state) => state.me?.profile.unit_weight ?? 'kg');
  const [bar, setBar] = useState(BARS[unit][0] ?? 20);
  const [text, setText] = useState('');
  const working = parseDecimal(text);
  const sets = working === null ? [] : warmupSets(working, bar, PLATES[unit]);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <TextField
        label={`Working weight (${unit})`}
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
      />
      <BarPicker unit={unit} bar={bar} onChange={setBar} />
      {sets.length ? (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            padding: spacing.lg,
            gap: spacing.sm,
          }}
        >
          {sets.map((set) => {
            const plates = describePlates(loadBar(set.weight, bar, PLATES[unit]).perSide);
            const name = `${set.weight} ${unit} × ${set.reps}`;
            return (
              <View key={set.weight} accessible accessibilityLabel={name}>
                <Text style={[typography.body, { color: colors.text, fontWeight: '600' }]}>
                  {name}
                  {set.percent ? `  ·  ${set.percent}%` : '  ·  empty bar'}
                </Text>
                {plates ? (
                  <Text style={[typography.caption, { color: colors.textMuted }]}>
                    Each side: {plates}
                  </Text>
                ) : null}
              </View>
            );
          })}
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            Then your working sets at {working} {unit}.
          </Text>
        </View>
      ) : (
        <Text style={[typography.body, { color: colors.textMuted }]}>
          Enter a working weight above the bar.
        </Text>
      )}
    </ScrollView>
  );
}
