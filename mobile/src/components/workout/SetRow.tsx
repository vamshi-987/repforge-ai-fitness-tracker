import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ExerciseType } from '@/api/types';
import { formatDuration, parseDuration } from '@/lib/format';
import { setInputs } from '@/lib/sets';
import { displayWeight, parseDecimal, weightToKg } from '@/lib/units';
import { useTheme } from '@/theme/useTheme';
import type { PreviousSet } from '@/workout/history';
import type { SetPatch } from '@/workout/model';
import {
  distanceToMeters,
  formatPrevious,
  metersToDistance,
  type Units,
} from '@/workout/setValues';
import type { WorkoutSet } from '@/workout/types';

import { NumberCell } from './NumberCell';

interface SetRowProps {
  /** "Bench Press set 2": prefix for every control's screen-reader label. */
  name: string;
  exerciseType: ExerciseType;
  set: WorkoutSet;
  /** "W", "1", "D"… */
  label: string;
  previous: PreviousSet | undefined;
  units: Units;
  onChange: (patch: SetPatch) => void;
  onToggle: () => void;
  onOpenMenu: () => void;
  onUsePrevious: () => void;
}

const parseCount = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);

/** One set: type, last session, the inputs for this exercise type, and the tick. */
export function SetRow({
  name,
  exerciseType,
  set,
  label,
  previous,
  units,
  onChange,
  onToggle,
  onOpenMenu,
  onUsePrevious,
}: SetRowProps) {
  const { colors, radius, spacing, typography } = useTheme();
  const inputs = setInputs(exerciseType);
  const prevText = formatPrevious(exerciseType, previous, units);

  return (
    <View
      style={[
        styles.row,
        {
          gap: spacing.xs,
          paddingVertical: spacing.xs,
          borderRadius: radius.sm,
          backgroundColor: set.completed ? `${colors.success}33` : 'transparent',
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name} options`}
        onPress={onOpenMenu}
        style={styles.setCol}
        hitSlop={6}
      >
        <Text
          style={[
            typography.body,
            styles.bold,
            { color: set.type === 'normal' ? colors.text : colors.primary },
          ]}
        >
          {label}
        </Text>
        {set.rpe !== null ? (
          <Text style={[typography.caption, { color: colors.textMuted }]}>@{set.rpe}</Text>
        ) : null}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name} previous: ${prevText}`}
        accessibilityState={{ disabled: !previous }}
        disabled={!previous}
        onPress={onUsePrevious}
        style={styles.prevCol}
      >
        <Text numberOfLines={1} style={[typography.caption, { color: colors.textMuted }]}>
          {prevText}
        </Text>
      </Pressable>

      {inputs.load ? (
        <View style={styles.flex}>
          <NumberCell
            label={`${name} weight`}
            value={set.weightKg}
            format={(kg) => String(displayWeight(kg, units.weight))}
            parse={(text) => {
              const n = parseDecimal(text);
              return n === null ? null : weightToKg(n, units.weight);
            }}
            onCommit={(weightKg) => onChange({ weightKg })}
            placeholder={
              previous?.weightKg != null
                ? String(displayWeight(previous.weightKg, units.weight))
                : '—'
            }
          />
        </View>
      ) : null}
      {inputs.distance ? (
        <View style={styles.flex}>
          <NumberCell
            label={`${name} distance`}
            value={set.distanceM}
            format={(m) => String(metersToDistance(m, units.length))}
            parse={(text) => {
              const n = parseDecimal(text);
              return n === null ? null : distanceToMeters(n, units.length);
            }}
            onCommit={(distanceM) => onChange({ distanceM })}
            placeholder={
              previous?.distanceM != null
                ? String(metersToDistance(previous.distanceM, units.length))
                : '—'
            }
          />
        </View>
      ) : null}
      {inputs.reps ? (
        <View style={styles.flex}>
          <NumberCell
            label={`${name} reps`}
            value={set.reps}
            format={String}
            parse={parseCount}
            onCommit={(reps) => onChange({ reps })}
            keyboardType="number-pad"
            placeholder={previous?.reps != null ? String(previous.reps) : '—'}
          />
        </View>
      ) : null}
      {inputs.duration ? (
        <View style={styles.flex}>
          <NumberCell
            label={`${name} time`}
            value={set.durationS}
            format={formatDuration}
            parse={parseDuration}
            onCommit={(durationS) => onChange({ durationS })}
            keyboardType="numbers-and-punctuation"
            placeholder={previous?.durationS != null ? formatDuration(previous.durationS) : '0:00'}
          />
        </View>
      ) : null}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`Complete ${name}`}
        accessibilityState={{ checked: set.completed }}
        onPress={onToggle}
        hitSlop={6}
        style={[
          styles.tick,
          {
            borderRadius: radius.sm,
            backgroundColor: set.completed ? colors.success : colors.background,
          },
        ]}
      >
        <Text style={[styles.bold, { color: set.completed ? '#FFFFFF' : colors.textMuted }]}>
          ✓
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  bold: { fontWeight: '700' },
  setCol: { width: 34, alignItems: 'center' },
  prevCol: { width: 84 },
  tick: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
