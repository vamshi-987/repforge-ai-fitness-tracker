import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { BarPicker } from '@/components/tools/BarPicker';
import { TextField } from '@/components/ui/TextField';
import { BARS, describePlates, loadBar, PLATES } from '@/lib/plates';
import { parseDecimal } from '@/lib/units';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

/** Which plates go on each side of the bar for a target weight. */
export default function PlateCalculatorScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const unit = useAuth((state) => state.me?.profile.unit_weight ?? 'kg');
  const [bar, setBar] = useState(BARS[unit][0] ?? 20);
  const [text, setText] = useState('');
  const target = parseDecimal(text);
  const load = target === null ? null : loadBar(target, bar, PLATES[unit]);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <TextField
        label={`Target weight (${unit})`}
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
      />
      <BarPicker unit={unit} bar={bar} onChange={setBar} />
      {load ? (
        <View
          accessible
          accessibilityLabel={
            load.perSide.length ? `Each side: ${describePlates(load.perSide)}` : 'Just the bar'
          }
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            padding: spacing.lg,
            gap: spacing.sm,
          }}
        >
          <Text style={[typography.caption, { color: colors.textMuted }]}>Each side</Text>
          <Text style={[typography.heading, { color: colors.text }]}>
            {load.perSide.length ? describePlates(load.perSide) : 'Just the bar'}
          </Text>
          <Text style={[typography.body, { color: colors.text }]}>
            Total {load.total} {unit}
          </Text>
          {load.short > 0 ? (
            <Text style={[typography.caption, { color: colors.warning }]}>
              {load.short} {unit} short: the plates can&apos;t make {target} {unit} exactly.
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={[typography.body, { color: colors.textMuted }]}>
          Plates: {PLATES[unit].join(', ')} {unit}.
        </Text>
      )}
    </ScrollView>
  );
}
