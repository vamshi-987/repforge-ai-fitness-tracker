import { createStore } from 'zustand/vanilla';

import { makeWorkout } from '@/test/workouts';

import { persistWorkout, SAVE_DELAY_MS } from '../persist';
import { createMemoryWorkoutStorage, type ActiveWorkoutStorage } from '../storage';
import type { ActiveWorkout } from '../types';

function setup(initial: ActiveWorkout | null = null, storage = createMemoryWorkoutStorage()) {
  const store = createStore<{ workout: ActiveWorkout | null }>()(() => ({ workout: initial }));
  const persister = persistWorkout(store, storage);
  return { store, storage, persister };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('persistWorkout', () => {
  it('batches quick changes into one write of the latest state', async () => {
    const { store, storage } = setup();

    store.setState({ workout: makeWorkout({ title: 'A' }) });
    store.setState({ workout: makeWorkout({ title: 'AB' }) });
    store.setState({ workout: makeWorkout({ title: 'ABC' }) });
    expect(storage.saves).toBe(0);

    await jest.advanceTimersByTimeAsync(SAVE_DELAY_MS);

    expect(storage.saves).toBe(1);
    expect((await storage.load())?.title).toBe('ABC');
  });

  it('writes the end of a workout at once', async () => {
    const { store, storage } = setup();
    store.setState({ workout: makeWorkout() });
    await jest.advanceTimersByTimeAsync(SAVE_DELAY_MS);

    store.setState({ workout: makeWorkout({ title: 'pending' }) });
    store.setState({ workout: null });
    await Promise.resolve();

    expect(await storage.load()).toBeNull();
    // The pending save was dropped, so the workout can't come back.
    await jest.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(await storage.load()).toBeNull();
  });

  it('flushes a pending change immediately (app going to the background)', async () => {
    const { store, storage, persister } = setup();

    store.setState({ workout: makeWorkout({ title: 'Now' }) });
    await persister.flush();

    expect((await storage.load())?.title).toBe('Now');
    expect(storage.saves).toBe(1);
    await jest.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(storage.saves).toBe(1);
  });

  it('does not write back what was just restored', async () => {
    const storage = createMemoryWorkoutStorage();
    const { persister } = setup(makeWorkout(), storage);

    await persister.flush();

    expect(storage.saves).toBe(0);
  });

  it('keeps saving after a failed write', async () => {
    const memory = createMemoryWorkoutStorage();
    let fail = true;
    const flaky: ActiveWorkoutStorage = {
      load: () => memory.load(),
      clear: () => memory.clear(),
      save: (w) => (fail ? Promise.reject(new Error('disk full')) : memory.save(w)),
    };
    const { store, persister } = setup(
      null,
      flaky as ReturnType<typeof createMemoryWorkoutStorage>,
    );

    store.setState({ workout: makeWorkout({ title: 'lost' }) });
    await persister.flush();
    fail = false;
    store.setState({ workout: makeWorkout({ title: 'saved' }) });
    await persister.flush();

    expect((await memory.load())?.title).toBe('saved');
  });

  it('stops listening', async () => {
    const { store, storage, persister } = setup();

    persister.stop();
    store.setState({ workout: makeWorkout() });
    await jest.advanceTimersByTimeAsync(SAVE_DELAY_MS);

    expect(storage.saves).toBe(0);
  });
});
