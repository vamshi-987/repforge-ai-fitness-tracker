import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { WorkoutRow } from '@/components/workout/WorkoutRow';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';
import { useWorkoutHistory } from '@/workout/historyStore';
import {
  dayKey,
  dayKeyOf,
  monthGrid,
  monthOf,
  monthTitle,
  shiftMonth,
  workoutsByDay,
} from '@/workout/historyView';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** A month at a glance: days with a workout are marked; tap one to see its workouts. */
export default function WorkoutCalendarScreen() {
  const { colors, radius, spacing, typography } = useTheme();
  const unit = useAuth((state) => state.me?.profile.unit_weight ?? 'kg');
  const history = useWorkoutHistory();
  const [month, setMonth] = useState(() => monthOf(Date.now()));
  const [selected, setSelected] = useState(() => dayKey(Date.now()));
  if (!history.isSuccess) return null;

  const byDay = workoutsByDay(history.data);
  const title = monthTitle(month);
  const inMonth = monthGrid(month)
    .flat()
    .filter((day): day is number => day !== null)
    .reduce((n, day) => n + (byDay.get(dayKeyOf(month, day))?.length ?? 0), 0);
  const chosen = byDay.get(selected) ?? [];

  const arrow = (label: string, glyph: string, delta: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => setMonth((m) => shiftMonth(m, delta))}
      hitSlop={8}
      style={{ padding: spacing.sm }}
    >
      <Text style={[typography.heading, { color: colors.primary }]}>{glyph}</Text>
    </Pressable>
  );

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
    >
      <View style={[styles.row, styles.between]}>
        {arrow('Previous month', '‹', -1)}
        <View style={styles.center}>
          <Text accessibilityRole="header" style={[typography.heading, { color: colors.text }]}>
            {title}
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {inMonth} workout{inMonth === 1 ? '' : 's'}
          </Text>
        </View>
        {arrow('Next month', '›', 1)}
      </View>

      <View
        style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.sm }}
      >
        <View style={styles.row}>
          {WEEKDAYS.map((day, i) => (
            <Text
              key={i}
              style={[
                typography.caption,
                styles.cell,
                styles.centerText,
                { color: colors.textMuted },
              ]}
            >
              {day}
            </Text>
          ))}
        </View>
        {monthGrid(month).map((week, w) => (
          <View key={w} style={styles.row}>
            {week.map((day, d) => {
              if (day === null) return <View key={d} style={styles.cell} />;
              const key = dayKeyOf(month, day);
              const count = byDay.get(key)?.length ?? 0;
              const isSelected = key === selected;
              return (
                <Pressable
                  key={d}
                  accessibilityRole="button"
                  accessibilityLabel={`${day} ${title}: ${count} workout${count === 1 ? '' : 's'}`}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => setSelected(key)}
                  style={[styles.cell, styles.center, { paddingVertical: spacing.xs }]}
                >
                  <View
                    style={[
                      styles.day,
                      styles.center,
                      {
                        backgroundColor: count ? colors.primary : 'transparent',
                        borderColor: isSelected ? colors.text : 'transparent',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        typography.body,
                        {
                          color: count ? '#FFFFFF' : colors.text,
                          fontWeight: count ? '600' : '400',
                        },
                      ]}
                    >
                      {day}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <View style={{ gap: spacing.sm }}>
        {chosen.length ? (
          chosen.map((workout) => <WorkoutRow key={workout.id} workout={workout} unit={unit} />)
        ) : (
          <Text style={[typography.body, { color: colors.textMuted }]}>
            No workouts on this day.
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { justifyContent: 'space-between' },
  center: { alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  cell: { flex: 1 },
  day: { width: 36, height: 36, borderRadius: 18, borderWidth: 2 },
});
