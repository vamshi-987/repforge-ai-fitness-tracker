import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { useNow } from '../useNow';

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-27T18:00:00Z'));
});
afterEach(() => jest.useRealTimers());

describe('useNow', () => {
  it('ticks every interval', async () => {
    const { result } = await renderHook(() => useNow(1000));
    const start = result.current;

    await act(() => jest.advanceTimersByTimeAsync(3000));

    expect(result.current - start).toBe(3000);
  });

  it('catches up at once when the app comes back to the foreground', async () => {
    let listener: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      listener = handler as (state: AppStateStatus) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    const { result } = await renderHook(() => useNow(1000));
    const start = result.current;

    // Backgrounded for 3 minutes: no interval ticks ran meanwhile.
    jest.setSystemTime(start + 180_000);
    await act(async () => listener?.('active'));

    expect(result.current - start).toBe(180_000);
  });

  it('stands still when disabled', async () => {
    const { result } = await renderHook(() => useNow(1000, false));
    const start = result.current;

    await act(() => jest.advanceTimersByTimeAsync(5000));

    expect(result.current).toBe(start);
  });
});
