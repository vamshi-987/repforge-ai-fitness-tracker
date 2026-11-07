import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/social/Avatar';
import { TextField } from '@/components/ui/TextField';
import { followLabel } from '@/social/rules';
import { useUserSearch } from '@/social/store';
import { useTheme } from '@/theme/useTheme';

const DEBOUNCE_MS = 300;

export default function FindPeopleScreen() {
  const { colors, spacing, typography } = useTheme();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const results = useUserSearch(query);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      <TextField
        label="Name or username"
        value={text}
        onChangeText={setText}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {results.isError ? (
        <Text style={[typography.body, { color: colors.textMuted }]}>
          Searching needs a connection.
        </Text>
      ) : null}
      {results.data?.items.map((user) => (
        <Pressable
          key={user.id}
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
            <Text style={[typography.body, { color: colors.text }]}>{user.display_name}</Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>@{user.username}</Text>
          </View>
          {user.relation !== 'none' ? (
            <Text style={[typography.caption, { color: colors.textMuted }]}>
              {followLabel(user.relation)}
            </Text>
          ) : null}
        </Pressable>
      ))}
      {results.isSuccess && results.data.items.length === 0 ? (
        <Text style={[typography.body, { color: colors.textMuted }]}>Nobody found.</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
