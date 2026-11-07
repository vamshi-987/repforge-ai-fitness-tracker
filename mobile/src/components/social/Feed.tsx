import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { useFeed } from '@/social/store';
import { useTheme } from '@/theme/useTheme';

import { FeedCard } from './FeedCard';

export function Feed({ now }: { now: number }) {
  const { colors, spacing, typography } = useTheme();
  const feed = useFeed();
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <View style={{ gap: spacing.md }}>
      <Text accessibilityRole="header" style={[typography.heading, { color: colors.text }]}>
        Feed
      </Text>
      {feed.isError ? (
        <Text style={[typography.body, { color: colors.textMuted }]}>
          The feed needs a connection.
        </Text>
      ) : null}
      {items.map((workout) => (
        <FeedCard key={workout.id} workout={workout} now={now} />
      ))}
      {feed.isSuccess && items.length === 0 ? (
        <Text style={[typography.body, { color: colors.textMuted }]}>
          Follow people to see their workouts here.
        </Text>
      ) : null}
      {feed.hasNextPage ? (
        <Button
          label="Show more"
          variant="secondary"
          loading={feed.isFetchingNextPage}
          onPress={() => void feed.fetchNextPage()}
        />
      ) : null}
      <Button
        label="Find people"
        variant="secondary"
        onPress={() => router.push('/social/search')}
      />
    </View>
  );
}
