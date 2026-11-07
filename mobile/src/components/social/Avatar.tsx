import { Text, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';

/** The first letter of a name; picture uploads aren't built yet. */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const { colors, typography } = useTheme();

  return (
    <View
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primary,
      }}
    >
      <Text style={[typography.body, { color: '#FFFFFF', fontWeight: '700' }]}>
        {name.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}
