export const palette = {
  red500: '#E5383B', // primary accent, also the body-map "primary muscle" colour
  red200: '#F4A3A5', // body-map "secondary muscle" colour
  green500: '#2BB673',
  amber500: '#F5A524',
  gray50: '#F7F7F8',
  gray100: '#EDEDEF',
  gray300: '#C4C4CA',
  gray500: '#8A8A93',
  gray700: '#3A3A40',
  gray800: '#26262B',
  gray900: '#18181B',
  white: '#FFFFFF',
  black: '#0B0B0D',
} as const;

export type ColorScheme = 'light' | 'dark';

export interface ThemeColors {
  background: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryMuted: string;
  success: string;
  warning: string;
  danger: string;
}

export const colors: Record<ColorScheme, ThemeColors> = {
  light: {
    background: palette.gray50,
    surface: palette.white,
    border: palette.gray100,
    text: palette.gray900,
    textMuted: palette.gray500,
    primary: palette.red500,
    primaryMuted: palette.red200,
    success: palette.green500,
    warning: palette.amber500,
    danger: palette.red500,
  },
  dark: {
    background: palette.black,
    surface: palette.gray900,
    border: palette.gray800,
    text: palette.gray50,
    textMuted: palette.gray300,
    primary: palette.red500,
    primaryMuted: palette.red200,
    success: palette.green500,
    warning: palette.amber500,
    danger: palette.red500,
  },
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const typography = {
  title: { fontSize: 28, fontWeight: '700' },
  heading: { fontSize: 20, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400' },
  caption: { fontSize: 13, fontWeight: '400' },
} as const;
