import { Text } from 'react-native';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

export default function ProfileScreen() {
  const { colors, typography } = useTheme();
  const me = useAuth((state) => state.me);
  const signOut = useAuth((state) => state.signOut);

  return (
    <Screen title={me?.display_name ?? 'Profile'} subtitle={me ? `@${me.username}` : undefined}>
      <Text style={[typography.body, { color: colors.textMuted }]}>
        Stats, calendar and body measurements arrive in later phases.
      </Text>
      <Button label="Log out" variant="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}
