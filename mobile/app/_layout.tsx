import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { createQueryClient } from '@/api/queryClient';
import { destination } from '@/auth/destination';
import { DatabaseProvider } from '@/db/DatabaseProvider';
import { forgetUserExercises } from '@/exercises/library';
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
        if (previous.status === 'signedIn' && state.status === 'signedOut') {
          queryClient.clear();
          forgetUserExercises().catch(() => undefined);
        }
      }),
    [queryClient],
  );

  const header = {
    headerShown: true,
    headerStyle: { backgroundColor: theme.colors.surface },
    headerTintColor: theme.colors.text,
    headerShadowVisible: false,
  } as const;

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
            <Stack.Screen name="settings" options={{ ...header, title: 'Settings' }} />
            <Stack.Screen name="exercises/index" options={{ ...header, title: 'Exercises' }} />
            <Stack.Screen name="exercise/[id]" options={{ ...header, title: '' }} />
            <Stack.Screen name="exercise/form" options={{ ...header, title: 'Exercise' }} />
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
