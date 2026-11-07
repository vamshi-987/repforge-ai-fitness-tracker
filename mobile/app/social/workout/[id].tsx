import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { addComment, deleteComment } from '@/api/social';
import type { WorkoutComment } from '@/api/types';
import { Avatar } from '@/components/social/Avatar';
import { FeedCard } from '@/components/social/FeedCard';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useNow } from '@/lib/useNow';
import { whenLabel } from '@/social/rules';
import { SOCIAL_KEY, useComments, useFeedWorkout } from '@/social/store';
import { useTheme } from '@/theme/useTheme';

function Comment({
  comment,
  now,
  onDelete,
}: {
  comment: WorkoutComment;
  now: number;
  onDelete: () => void;
}) {
  const { colors, spacing, typography } = useTheme();

  return (
    <View style={[styles.row, { gap: spacing.sm }]}>
      <Avatar name={comment.user.display_name} size={32} />
      <View style={styles.flex}>
        <Text
          accessibilityRole="button"
          accessibilityLabel={`Open ${comment.user.display_name}’s profile`}
          onPress={() =>
            router.push({
              pathname: '/social/user/[username]',
              params: { username: comment.user.username },
            })
          }
          style={[typography.caption, { color: colors.textMuted }]}
        >
          {comment.user.display_name} · {whenLabel(comment.created_at, now)}
        </Text>
        <Text style={[typography.body, { color: colors.text }]}>{comment.body}</Text>
      </View>
      {comment.can_delete ? (
        <Text
          accessibilityRole="button"
          accessibilityLabel={`Delete comment: ${comment.body}`}
          onPress={onDelete}
          style={[typography.caption, { color: colors.danger }]}
        >
          Delete
        </Text>
      ) : null}
    </View>
  );
}

/** Someone's shared workout and its comments. */
export default function SharedWorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const now = useNow(60_000);
  const workout = useFeedWorkout(id);
  const comments = useComments(id);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: SOCIAL_KEY });

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await addComment(id, text.trim());
      setText('');
      await refresh();
    } catch {
      setError('Your comment couldn’t be sent. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(commentId: string) {
    try {
      await deleteComment(id, commentId);
      await refresh();
    } catch {
      setError('That comment couldn’t be deleted. Try again.');
    }
  }

  if (workout.isError) {
    return (
      <View style={{ padding: spacing.lg }}>
        <Text style={[typography.body, { color: colors.textMuted }]}>
          This workout isn’t available. It may be private or deleted, or you may be offline.
        </Text>
      </View>
    );
  }
  if (!workout.data) return null;

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      <FeedCard workout={workout.data} now={now} />
      {workout.data.notes ? (
        <Text style={[typography.body, { color: colors.text }]}>{workout.data.notes}</Text>
      ) : null}
      {comments.data?.items.map((comment) => (
        <Comment
          key={comment.id}
          comment={comment}
          now={now}
          onDelete={() => void remove(comment.id)}
        />
      ))}
      <TextField
        label="Add a comment"
        value={text}
        onChangeText={setText}
        maxLength={500}
        multiline
        error={error}
      />
      <Button
        label="Send"
        loading={busy}
        disabled={text.trim().length === 0}
        onPress={() => void send()}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  flex: { flex: 1 },
});
