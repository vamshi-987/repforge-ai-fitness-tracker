import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { likeWorkout, unlikeWorkout } from '@/api/social';
import type { FeedWorkout } from '@/api/types';
import { SOCIAL_KEY } from '@/social/store';
import { useTheme } from '@/theme/useTheme';

/** Shows the like at once and puts it back if the server says no. */
export function LikeButton({ workout }: { workout: FeedWorkout }) {
  const { colors, typography } = useTheme();
  const queryClient = useQueryClient();
  const [state, setState] = useState({ liked: workout.liked, like_count: workout.like_count });

  async function toggle() {
    const before = state;
    setState({
      liked: !state.liked,
      like_count: state.like_count + (state.liked ? -1 : 1),
    });
    try {
      setState(await (before.liked ? unlikeWorkout(workout.id) : likeWorkout(workout.id)));
      await queryClient.invalidateQueries({ queryKey: SOCIAL_KEY });
    } catch {
      setState(before);
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${state.liked ? 'Unlike' : 'Like'} ${workout.title}, ${state.like_count} likes`}
      accessibilityState={{ selected: state.liked }}
      hitSlop={8}
      onPress={() => void toggle()}
    >
      <Text style={[typography.body, { color: state.liked ? colors.primary : colors.textMuted }]}>
        {state.liked ? '♥' : '♡'} {state.like_count}
      </Text>
    </Pressable>
  );
}
