import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { BODY_QUERY_KEY } from '@/body/store';

import { healthBridge } from './bridge';
import { healthEnabled, importHealthWeights } from './sync';

/** Bring in new weigh-ins on launch and whenever the app comes back to the front. */
export function useHealthSync(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    async function run() {
      try {
        if (!(await healthEnabled())) return;
        const added = await importHealthWeights(await healthBridge());
        if (added > 0) await queryClient.invalidateQueries({ queryKey: BODY_QUERY_KEY });
      } catch {
        // Health data is an extra; the next launch tries again.
      }
    }
    void run();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void run();
    });
    return () => subscription.remove();
  }, [queryClient]);
}
