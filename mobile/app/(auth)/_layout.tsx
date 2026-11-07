import { Stack } from 'expo-router';

import { destination } from '@/auth/destination';
import { useAuth } from '@/stores/auth';

export default function AuthLayout() {
  const where = useAuth((state) => destination(state.status, state.me, state.meStatus));

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Protected guard={where === 'login'}>
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
      </Stack.Protected>
      <Stack.Protected guard={where === 'onboarding'}>
        <Stack.Screen name="onboarding/[step]" options={{ animation: 'slide_from_right' }} />
      </Stack.Protected>
    </Stack>
  );
}
