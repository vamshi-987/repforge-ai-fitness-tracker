import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDuration } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { useRestTimer } from '@/stores/timer';
import { useTheme } from '@/theme/useTheme';
import { REST_STEP_S, remainingMs, remainingSeconds } from '@/workout/rest';

const subtractRest = () => useRestTimer.getState().adjust(-REST_STEP_S, Date.now());
const addRest = () => useRestTimer.getState().adjust(REST_STEP_S, Date.now());
const skipRest = () => useRestTimer.getState().skip();

/** The running rest: time left, progress, ±15 s and skip. Hidden when not resting. */
export function RestTimer() {
  const { colors, radius, spacing, typography } = useTheme();
  const endsAt = useRestTimer((state) => state.endsAt);
  const totalS = useRestTimer((state) => state.totalS);
  const label = useRestTimer((state) => state.label);
  const now = useNow(250, endsAt !== null);

  if (endsAt === null) return null;
  const left = formatDuration(remainingSeconds(endsAt, now));
  const done = totalS > 0 ? 1 - remainingMs(endsAt, now) / (totalS * 1000) : 1;

  const control = (text: string, accessibilityLabel: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={6}
      style={[
        styles.control,
        { borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md },
      ]}
    >
      <Text style={[typography.body, styles.bold, { color: colors.text }]}>{text}</Text>
    </Pressable>
  );

  return (
    <View
      accessibilityLabel={`Rest timer: ${left} left`}
      style={{
        backgroundColor: colors.surface,
        borderTopColor: colors.border,
        borderTopWidth: StyleSheet.hairlineWidth,
        padding: spacing.md,
        gap: spacing.sm,
      }}
    >
      <View style={[styles.track, { backgroundColor: colors.border, borderRadius: radius.pill }]}>
        <View
          style={[
            styles.fill,
            {
              width: `${Math.min(100, Math.max(0, done * 100))}%`,
              backgroundColor: colors.primary,
              borderRadius: radius.pill,
            },
          ]}
        />
      </View>
      <View style={[styles.row, { gap: spacing.sm }]}>
        {control(`−${REST_STEP_S}`, `Subtract ${REST_STEP_S} seconds`, subtractRest)}
        <View style={[styles.flex, styles.center]}>
          <Text style={[typography.heading, styles.clock, { color: colors.text }]}>{left}</Text>
          <Text numberOfLines={1} style={[typography.caption, { color: colors.textMuted }]}>
            Rest · {label}
          </Text>
        </View>
        {control(`+${REST_STEP_S}`, `Add ${REST_STEP_S} seconds`, addRest)}
        {control('Skip', 'Skip rest', skipRest)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  center: { alignItems: 'center' },
  bold: { fontWeight: '600' },
  clock: { fontVariant: ['tabular-nums'] },
  track: { height: 4, overflow: 'hidden' },
  fill: { height: 4 },
  control: { minHeight: 40, justifyContent: 'center', borderWidth: 1 },
});
