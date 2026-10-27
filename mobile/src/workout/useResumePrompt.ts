import { useEffect } from 'react';

import { useActiveWorkout } from '@/stores/activeWorkout';

import { askToResume } from './prompts';
import { openActiveWorkout } from './start';

/** Once per launch, when a workout survived the app being closed: resume or discard it. */
export function useResumePrompt(): void {
  const restored = useActiveWorkout((state) => state.restored);

  useEffect(() => {
    const { workout, acknowledgeRestore, end } = useActiveWorkout.getState();
    if (!restored || !workout) return;
    askToResume(workout, Date.now(), {
      onResume: () => {
        acknowledgeRestore();
        openActiveWorkout();
      },
      onDiscard: end,
    });
  }, [restored]);
}
