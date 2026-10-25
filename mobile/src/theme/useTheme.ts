import { useColorScheme } from 'react-native';

import type { ThemePreference } from '@/api/types';
import { useAuth } from '@/stores/auth';

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

/** The user's Settings choice wins; "system" follows the OS. */
export function resolveScheme(
  preference: ThemePreference,
  system: string | null | undefined,
): ColorScheme {
  if (preference !== 'system') return preference;
  return system === 'dark' ? 'dark' : 'light';
}

export function useTheme(): Theme {
  const system = useColorScheme();
  const preference = useAuth((state) => state.me?.settings.theme ?? 'system');
  return themeFor(resolveScheme(preference, system));
}
