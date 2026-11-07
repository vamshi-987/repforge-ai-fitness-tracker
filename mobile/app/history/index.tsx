import { router } from 'expo-router';
import { SectionList, Text } from 'react-native';

import { Button } from '@/components/ui/Button';
import { WorkoutRow } from '@/components/workout/WorkoutRow';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';
import { useWorkoutHistory } from '@/workout/historyStore';
import { groupByMonth } from '@/workout/historyView';

/** Every finished workout on the device, newest first, by month. Works offline. */
export default function WorkoutHistoryScreen() {
  const { colors, spacing, typography } = useTheme();
  const unit = useAuth((state) => state.me?.profile.unit_weight ?? 'kg');
  const history = useWorkoutHistory();
  if (!history.isSuccess) return null;

  return (
    <SectionList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
      sections={groupByMonth(history.data)}
      keyExtractor={(workout) => workout.id}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <Button
          label="Calendar"
          variant="secondary"
          onPress={() => router.push('/history/calendar')}
        />
      }
      ListEmptyComponent={
        <Text style={[typography.body, { color: colors.textMuted }]}>
          No workouts yet. Finished workouts show up here.
        </Text>
      }
      renderSectionHeader={({ section }) => (
        <Text
          accessibilityRole="header"
          style={[typography.caption, { color: colors.textMuted, marginTop: spacing.md }]}
        >
          {section.title.toUpperCase()} · {section.data.length} workout
          {section.data.length === 1 ? '' : 's'}
        </Text>
      )}
      renderItem={({ item }) => <WorkoutRow workout={item} unit={unit} />}
    />
  );
}
