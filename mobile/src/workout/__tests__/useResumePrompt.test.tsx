import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { useActiveWorkout } from '@/stores/activeWorkout';
import { makeWorkout } from '@/test/workouts';

import { useResumePrompt } from '../useResumePrompt';

jest.mock('@/workout/sqliteStorage', () => {
  const { createMemoryWorkoutStorage } =
    jest.requireActual<typeof import('@/workout/storage')>('@/workout/storage');
  return { sqliteWorkoutStorage: createMemoryWorkoutStorage() };
});

type Buttons = Parameters<typeof Alert.alert>[2];

beforeEach(() => {
  jest.restoreAllMocks();
  useActiveWorkout.setState({ workout: null, restored: false, hydrated: true });
});

function pressOn(label: string) {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons: Buttons) => {
    buttons?.find((b) => b.text === label)?.onPress?.();
  });
}

describe('useResumePrompt', () => {
  it('asks once and keeps the workout on Resume', async () => {
    const alert = pressOn('Resume');
    useActiveWorkout.setState({ workout: makeWorkout({ title: 'Push' }), restored: true });

    await renderHook(() => useResumePrompt());

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]?.[1]).toMatch(/^“Push” started/);
    expect(useActiveWorkout.getState()).toMatchObject({
      restored: false,
      workout: { title: 'Push' },
    });
  });

  it('drops the workout on Discard', async () => {
    pressOn('Discard');
    useActiveWorkout.setState({ workout: makeWorkout(), restored: true });

    await renderHook(() => useResumePrompt());

    expect(useActiveWorkout.getState().workout).toBeNull();
  });

  it('stays quiet for a workout started in this session', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    await renderHook(() => useResumePrompt());

    await act(async () => {
      useActiveWorkout.getState().start(makeWorkout());
    });

    expect(alert).not.toHaveBeenCalled();
  });
});
