import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';

import { createQueryClient } from '@/api/queryClient';
import { DatabaseProvider } from '@/db/DatabaseProvider';
import { useTheme } from '@/theme/useTheme';

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  const theme = useTheme();

  return (
    <QueryClientProvider client={queryClient}>
      <DatabaseProvider>
        <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.background },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" />
        </Stack>
      </DatabaseProvider>
    </QueryClientProvider>
  );
}
