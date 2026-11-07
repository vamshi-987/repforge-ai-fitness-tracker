import { Stack } from 'expo-router';

import { useTheme } from '@/theme/useTheme';

export default function NutritionLayout() {
  const { colors } = useTheme();
  const header = {
    headerShown: true,
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.text,
    headerShadowVisible: false,
  } as const;

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="add" options={{ ...header, title: 'Add food' }} />
      <Stack.Screen name="food/[id]" options={{ ...header, title: '' }} />
      <Stack.Screen name="custom" options={{ ...header, title: 'Custom food' }} />
      <Stack.Screen name="review-photo" options={{ ...header, title: 'Review' }} />
      <Stack.Screen name="targets" options={{ ...header, title: 'Daily targets' }} />
      <Stack.Screen name="plan" options={{ ...header, title: 'Planned meal' }} />
    </Stack>
  );
}
