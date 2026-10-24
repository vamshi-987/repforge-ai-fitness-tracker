import { useColorScheme } from 'react-native';

import { colors, radius, spacing, typography, type ColorScheme, type ThemeColors } from './tokens';

export interface Theme {
  scheme: ColorScheme;
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
}

export function themeFor(scheme: ColorScheme): Theme {
  return { scheme, colors: colors[scheme], spacing, radius, typography };
}

export function useTheme(): Theme {
  // A user-selected theme setting overrides the OS scheme in Phase 1.
  return themeFor(useColorScheme() === 'dark' ? 'dark' : 'light');
}
