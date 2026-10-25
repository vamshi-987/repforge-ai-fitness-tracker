import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { createQueryClient } from '@/api/queryClient';
import { DatabaseProvider } from '@/db/DatabaseProvider';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/theme/useTheme';

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  const theme = useTheme();
  const bootstrap = useAuth((state) => state.bootstrap);
  const signedIn = useAuth((state) => state.status === 'signedIn');
  const hasProfile = useAuth((state) => state.me !== null);

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
          <Stack.Protected guard={signedIn && hasProfile}>
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
        </Stack>
      </DatabaseProvider>
    </QueryClientProvider>
  );
}
