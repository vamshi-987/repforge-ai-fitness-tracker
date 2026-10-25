import { resolveScheme, themeFor } from '../useTheme';

describe('resolveScheme', () => {
  it.each([
    ['system', 'dark', 'dark'],
    ['system', 'light', 'light'],
    ['system', null, 'light'],
    ['dark', 'light', 'dark'],
    ['light', 'dark', 'light'],
  ] as const)('%s preference with OS %p → %s', (preference, system, expected) => {
    expect(resolveScheme(preference, system)).toBe(expected);
  });

  it('keeps the body-map reds in both schemes', () => {
    expect(themeFor('dark').colors.primary).toBe('#E5383B');
    expect(themeFor('light').colors.primaryMuted).toBe('#F4A3A5');
  });
});
