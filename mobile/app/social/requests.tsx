import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { acceptFollowRequest, removeFollower } from '@/api/social';
import { Avatar } from '@/components/social/Avatar';
import { Button } from '@/components/ui/Button';
import { SOCIAL_KEY, useFollowRequests } from '@/social/store';
import { useTheme } from '@/theme/useTheme';

/** People asking to follow a private profile. */
export default function FollowRequestsScreen() {
  const { colors, spacing, typography } = useTheme();
  const queryClient = useQueryClient();
  const requests = useFollowRequests();
  const [error, setError] = useState<string | null>(null);

  async function answer(run: () => Promise<void>) {
    setError(null);
    try {
      await run();
      await queryClient.invalidateQueries({ queryKey: SOCIAL_KEY });
    } catch {
      setError('That didn’t work. Check your connection and try again.');
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      {error ? <Text style={[typography.body, { color: colors.danger }]}>{error}</Text> : null}
      {requests.isError ? (
        <Text style={[typography.body, { color: colors.textMuted }]}>
          Follow requests need a connection.
        </Text>
      ) : null}
      {requests.data?.items.map(({ user }) => (
        <View key={user.id} style={{ gap: spacing.sm }}>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Avatar name={user.display_name} />
            <View style={styles.flex}>
              <Text style={[typography.body, { color: colors.text }]}>{user.display_name}</Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                @{user.username}
              </Text>
            </View>
          </View>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <View style={styles.flex}>
              <Button
                label={`Accept ${user.display_name}`}
                onPress={() => void answer(() => acceptFollowRequest(user.id))}
              />
            </View>
            <View style={styles.flex}>
              <Button
                label={`Decline ${user.display_name}`}
                variant="secondary"
                onPress={() => void answer(() => removeFollower(user.id))}
              />
            </View>
          </View>
        </View>
      ))}
      {requests.isSuccess && requests.data.items.length === 0 ? (
        <Text style={[typography.body, { color: colors.textMuted }]}>No requests right now.</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
