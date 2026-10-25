import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { createQueryClient } from '@/api/queryClient';
import { destination } from '@/auth/destination';
import { DatabaseProvider } from '@/db/DatabaseProvider';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  const theme = useTheme();
  const bootstrap = useAuth((state) => state.bootstrap);
  const where = useAuth((state) => destination(state.status, state.me, state.meStatus));

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Never show one account's cached server data to the next one.
  useEffect(
    () =>
      useAuth.subscribe((state, previous) => {
        if (previous.status === 'signedIn' && state.status === 'signedOut') queryClient.clear();
      }),
    [queryClient],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <DatabaseProvider>
        <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
        {/* `index` is never guarded: it shows the splash and redirects (src/auth/destination.ts). */}
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.background },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Protected guard={where === 'app'}>
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
          {/* Login/register and onboarding; app/(auth)/_layout.tsx guards each part. */}
          <Stack.Protected guard={where === 'login' || where === 'onboarding'}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
        </Stack>
      </DatabaseProvider>
    </QueryClientProvider>
  );
}
