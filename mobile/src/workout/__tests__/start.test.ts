import { Alert } from 'react-native';

import { useActiveWorkout } from '@/stores/activeWorkout';
import { makeRoutine } from '@/test/routines';
import { makeWorkout } from '@/test/workouts';

import { startEmptyWorkout, startRoutineWorkout } from '../start';

jest.mock('@/workout/sqliteStorage', () => ({ sqliteWorkoutStorage: {} }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const expoRouter = jest.requireMock<{ router: { push: jest.Mock } }>('expo-router');
type Buttons = Parameters<typeof Alert.alert>[2];

beforeEach(() => {
  jest.restoreAllMocks();
  expoRouter.router.push.mockClear();
  useActiveWorkout.setState({ workout: null, restored: false });
});

function pressOn(label: string) {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons: Buttons) => {
    buttons?.find((b) => b.text === label)?.onPress?.();
  });
}

describe('starting a workout', () => {
  it('starts an empty workout now and opens it', () => {
    const before = Date.now();
    startEmptyWorkout();

    const workout = useActiveWorkout.getState().workout;
    expect(workout?.exercises).toEqual([]);
    expect(workout?.startedAt).toBeGreaterThanOrEqual(before);
    expect(workout?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(expoRouter.router.push).toHaveBeenCalledWith('/workout/active');
  });

  it('starts a routine with its exercises', () => {
    startRoutineWorkout(makeRoutine({ name: 'Push' }));

    expect(useActiveWorkout.getState().workout).toMatchObject({
      title: 'Push',
      routineId: 'r-push',
    });
  });

  it('resumes the workout in progress instead', () => {
    const alert = pressOn('Resume');
    useActiveWorkout.setState({ workout: makeWorkout({ title: 'Legs' }) });

    startRoutineWorkout(makeRoutine({ name: 'Push' }));

    expect(alert.mock.calls[0]?.[1]).toMatch(/“Legs” isn't finished yet/);
    expect(useActiveWorkout.getState().workout?.title).toBe('Legs');
    expect(expoRouter.router.push).toHaveBeenCalledWith('/workout/active');
  });

  it('or discards it and starts the new one', () => {
    pressOn('Discard and start');
    useActiveWorkout.setState({ workout: makeWorkout({ title: 'Legs' }) });

    startRoutineWorkout(makeRoutine({ name: 'Push' }));

    expect(useActiveWorkout.getState().workout?.title).toBe('Push');
  });

  it('or does nothing on Cancel', () => {
    pressOn('Cancel');
    useActiveWorkout.setState({ workout: makeWorkout({ title: 'Legs' }) });

    startEmptyWorkout();

    expect(useActiveWorkout.getState().workout?.title).toBe('Legs');
    expect(expoRouter.router.push).not.toHaveBeenCalled();
  });
});
