import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';

import { useLibrarySync } from '@/exercises/library';
import { useTheme } from '@/theme/useTheme';

// Text glyphs keep the scaffold free of icon dependencies; a proper icon set lands with the UI work.
function TabGlyph({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const { colors } = useTheme();
  // Keep the offline exercise library fresh (a few empty 304s when nothing changed).
  useLibrarySync();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <TabGlyph glyph="⌂" color={color} />,
        }}
      />
      <Tabs.Screen
        name="workout"
        options={{
          title: 'Workout',
          tabBarIcon: ({ color }) => <TabGlyph glyph="✚" color={color} />,
        }}
      />
      <Tabs.Screen
        name="nutrition"
        options={{
          title: 'Nutrition',
          tabBarIcon: ({ color }) => <TabGlyph glyph="◔" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <TabGlyph glyph="●" color={color} />,
        }}
      />
    </Tabs>
  );
}
