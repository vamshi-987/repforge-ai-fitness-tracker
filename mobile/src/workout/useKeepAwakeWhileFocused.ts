import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

const TAG = 'active-workout';

/** Keep the screen on while this screen is in front (Settings → Keep screen awake). */
export function useKeepAwakeWhileFocused(enabled: boolean): void {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      activateKeepAwakeAsync(TAG).catch(() => undefined);
      return () => {
        deactivateKeepAwake(TAG).catch(() => undefined);
      };
    }, [enabled]),
  );
}
