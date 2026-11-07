import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { follow, unfollow } from '@/api/social';
import type { UserProfile } from '@/api/types';
import { Avatar } from '@/components/social/Avatar';
import { FeedCard } from '@/components/social/FeedCard';
import { Button } from '@/components/ui/Button';
import { useNow } from '@/lib/useNow';
import { followLabel } from '@/social/rules';
import { SOCIAL_KEY, useUser, useUserWorkouts } from '@/social/store';
import { useTheme } from '@/theme/useTheme';

function FollowButton({ user }: { user: UserProfile }) {
  const { colors, typography } = useTheme();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    setBusy(true);
    setFailed(false);
    try {
      if (user.relation === 'none') await follow(user.id);
      else await unfollow(user.id);
      await queryClient.invalidateQueries({ queryKey: SOCIAL_KEY });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        label={followLabel(user.relation)}
        variant={user.relation === 'none' ? 'primary' : 'secondary'}
        loading={busy}
        onPress={() => void toggle()}
      />
      {failed ? (
        <Text style={[typography.caption, { color: colors.danger }]}>
          That didn’t work. Check your connection and try again.
        </Text>
      ) : null}
    </>
  );
}

/** Someone's profile, with the workouts the viewer is allowed to see. */
export default function UserScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { colors, spacing, typography } = useTheme();
  const now = useNow(60_000);
  const user = useUser(username);
  const workouts = useUserWorkouts(username, user.data?.can_view_workouts === true);
  const items = workouts.data?.pages.flatMap((page) => page.items) ?? [];

  if (user.isError) {
    return (
      <View style={{ padding: spacing.lg }}>
        <Text style={[typography.body, { color: colors.textMuted }]}>
          This profile isn’t available right now.
        </Text>
      </View>
    );
  }
  if (!user.data) return null;
  const profile = user.data;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      <Stack.Screen options={{ title: `@${profile.username}` }} />
      <View style={[styles.row, { gap: spacing.md }]}>
        <Avatar name={profile.display_name} size={64} />
        <View style={styles.flex}>
          <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>
            {profile.display_name}
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {profile.followers} followers · {profile.following} following
          </Text>
        </View>
      </View>
      {profile.relation !== 'self' ? <FollowButton user={profile} /> : null}
      {profile.can_view_workouts ? (
        items.map((workout) => <FeedCard key={workout.id} workout={workout} now={now} />)
      ) : (
        <Text style={[typography.body, { color: colors.textMuted }]}>
          This profile is private. Follow to ask for access.
        </Text>
      )}
      {workouts.isSuccess && items.length === 0 ? (
        <Text style={[typography.body, { color: colors.textMuted }]}>No workouts to show.</Text>
      ) : null}
      {workouts.hasNextPage ? (
        <Button
          label="Show more"
          variant="secondary"
          loading={workouts.isFetchingNextPage}
          onPress={() => void workouts.fetchNextPage()}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
