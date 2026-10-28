import { router } from 'expo-router';
import { Text } from 'react-native';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/Button';
import { formatHeight, formatWeight } from '@/lib/units';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

export default function ProfileScreen() {
  const { colors, typography } = useTheme();
  const me = useAuth((state) => state.me);
  const profile = me?.profile;
  const body = [
    profile?.height_cm != null ? formatHeight(profile.height_cm, profile.unit_length) : null,
    profile?.weight_kg != null ? formatWeight(profile.weight_kg, profile.unit_weight) : null,
  ].filter(Boolean);

  return (
    <Screen title={me?.display_name ?? 'Profile'} subtitle={me ? `@${me.username}` : undefined}>
      {body.length ? (
        <Text style={[typography.body, { color: colors.text }]}>{body.join(' · ')}</Text>
      ) : null}
      <Button label="Workout history" variant="secondary" onPress={() => router.push('/history')} />
      <Button
        label="Calendar"
        variant="secondary"
        onPress={() => router.push('/history/calendar')}
      />
      <Button label="Settings" variant="secondary" onPress={() => router.push('/settings')} />
    </Screen>
  );
}
