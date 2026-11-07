import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { FeedWorkout } from '@/api/types';
import { exerciseLine, whenLabel, workoutLine } from '@/social/rules';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

import { Avatar } from './Avatar';
import { LikeButton } from './LikeButton';

/** One shared workout. The name opens the person; the rest opens the workout. */
export function FeedCard({ workout, now }: { workout: FeedWorkout; now: number }) {
  const { colors, radius, spacing, typography } = useTheme();
  const unit = useAuth((state) => state.me?.profile.unit_weight ?? 'kg');
  const { user } = workout;

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        gap: spacing.sm,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${user.display_name}’s profile`}
        onPress={() =>
          router.push({
            pathname: '/social/user/[username]',
            params: { username: user.username },
          })
        }
        style={[styles.row, { gap: spacing.sm }]}
      >
        <Avatar name={user.display_name} />
        <View style={styles.flex}>
          <Text style={[typography.body, styles.bold, { color: colors.text }]}>
            {user.display_name}
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {whenLabel(workout.ended_at, now)}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${workout.title}`}
        onPress={() =>
          router.push({ pathname: '/social/workout/[id]', params: { id: workout.id } })
        }
        style={{ gap: spacing.xs }}
      >
        <Text style={[typography.heading, { color: colors.text }]}>{workout.title}</Text>
        <Text style={[typography.caption, { color: colors.textMuted }]}>
          {workoutLine(workout, unit)}
        </Text>
        <Text numberOfLines={2} style={[typography.caption, { color: colors.textMuted }]}>
          {exerciseLine(workout)}
        </Text>
      </Pressable>
      <View style={[styles.row, { gap: spacing.lg }]}>
        {/* Remounts when fresh data arrives, so its local count can't go stale. */}
        <LikeButton key={`${workout.liked}:${workout.like_count}`} workout={workout} />
        <Text style={[typography.body, { color: colors.textMuted }]}>
          💬 {workout.comment_count}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  bold: { fontWeight: '600' },
});
