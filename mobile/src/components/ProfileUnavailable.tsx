import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

/** Signed in, but this device has never loaded the profile and the API is unreachable. */
export function ProfileUnavailable() {
  const { colors, spacing, typography } = useTheme();
  const refreshMe = useAuth((state) => state.refreshMe);
  const signOut = useAuth((state) => state.signOut);
  const loading = useAuth((state) => state.meStatus === 'loading');

  return (
    <View
      style={[
        styles.center,
        { backgroundColor: colors.background, padding: spacing.xl, gap: spacing.md },
      ]}
    >
      <Text style={[typography.heading, { color: colors.text }]}>Can&apos;t reach RepForge</Text>
      <Text style={[typography.body, styles.text, { color: colors.textMuted }]}>
        We need to load your profile once. Check your connection and try again.
      </Text>
      <Button label="Try again" onPress={() => void refreshMe()} loading={loading} />
      <Button label="Log out" variant="ghost" onPress={() => void signOut()} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center' },
  text: { textAlign: 'center' },
});
