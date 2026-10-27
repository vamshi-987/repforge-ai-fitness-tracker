import { makeRoutine } from '@/test/routines';
import { makeWorkout } from '@/test/workouts';
import { addSet, startFromRoutine, updateSet } from '@/workout/model';
import { persistWorkout, SAVE_DELAY_MS } from '@/workout/persist';
import { createMemoryWorkoutStorage, type ActiveWorkoutStorage } from '@/workout/storage';
import { elapsedMs, formatElapsed } from '@/workout/time';

import { createActiveWorkoutStore } from '../activeWorkout';

jest.mock('@/workout/sqliteStorage', () => ({ sqliteWorkoutStorage: {} }));

describe('active workout store', () => {
  it('starts one workout at a time', () => {
    const store = createActiveWorkoutStore(createMemoryWorkoutStorage());
    const first = makeWorkout({ id: 'first' });

    expect(store.getState().start(first)).toBe(true);
    expect(store.getState().start(makeWorkout({ id: 'second' }))).toBe(false);
    expect(store.getState().workout?.id).toBe('first');
  });

  it('applies model changes, and ignores them without a workout', () => {
    const store = createActiveWorkoutStore(createMemoryWorkoutStorage());
    const change = jest.fn((w) => ({ ...w, title: 'Changed' }));

    store.getState().update(change);
    expect(change).not.toHaveBeenCalled();

    store.getState().start(makeWorkout());
    store.getState().update(change);
    expect(store.getState().workout?.title).toBe('Changed');

    store.getState().end();
    expect(store.getState().workout).toBeNull();
  });

  it('restores a saved workout on launch and flags it once', async () => {
    const storage = createMemoryWorkoutStorage();
    await storage.save(makeWorkout({ title: 'Saved' }));
    const store = createActiveWorkoutStore(storage);

    await store.getState().hydrate();

    expect(store.getState()).toMatchObject({ hydrated: true, restored: true });
    expect(store.getState().workout?.title).toBe('Saved');
    store.getState().acknowledgeRestore();
    expect(store.getState().restored).toBe(false);
  });

  it('launches clean when nothing was saved or storage fails', async () => {
    const empty = createActiveWorkoutStore(createMemoryWorkoutStorage());
    const broken: ActiveWorkoutStorage = {
      load: () => Promise.reject(new Error('corrupt')),
      save: jest.fn(),
      clear: jest.fn(),
    };
    const failing = createActiveWorkoutStore(broken);

    await empty.getState().hydrate();
    await failing.getState().hydrate();

    for (const store of [empty, failing]) {
      expect(store.getState()).toMatchObject({ workout: null, hydrated: true, restored: false });
    }
  });

  it('a workout started before storage answered is kept', async () => {
    const storage = createMemoryWorkoutStorage();
    await storage.save(makeWorkout({ id: 'old' }));
    const store = createActiveWorkoutStore(storage);

    const hydrating = store.getState().hydrate();
    store.getState().start(makeWorkout({ id: 'new' }));
    await hydrating;

    expect(store.getState()).toMatchObject({ restored: false, workout: { id: 'new' } });
  });

  it('survives the app being killed mid-workout, timer included', async () => {
    jest.useFakeTimers();
    try {
      const disk = createMemoryWorkoutStorage();
      const startedAt = Date.UTC(2026, 9, 27, 18, 0, 0);

      // First launch: start a routine, log a set.
      const before = createActiveWorkoutStore(disk);
      await before.getState().hydrate();
      const persister = persistWorkout(before, disk);
      let n = 0;
      before
        .getState()
        .start(startFromRoutine(makeRoutine({ name: 'Push' }), () => `id-${++n}`, startedAt));
      const exercise = before.getState().workout?.exercises[0];
      const set = exercise?.sets[1];
      before
        .getState()
        .update((w) =>
          updateSet(w, exercise?.id ?? '', set?.id ?? '', { reps: 9, completed: true }),
        );
      before.getState().update((w) => addSet(w, exercise?.id ?? '', 'extra'));
      await jest.advanceTimersByTimeAsync(SAVE_DELAY_MS);
      persister.stop();

      // Killed. Relaunched 25 minutes later: a fresh store reads the same storage.
      const after = createActiveWorkoutStore(disk);
      await after.getState().hydrate();

      expect(after.getState().restored).toBe(true);
      expect(after.getState().workout).toEqual(before.getState().workout);
      const restored = after.getState().workout;
      expect(restored?.exercises[0]?.sets[1]).toMatchObject({ reps: 9, completed: true });
      expect(restored?.exercises[0]?.sets).toHaveLength(4);
      const now = startedAt + 25 * 60_000 + 7_000;
      expect(formatElapsed(elapsedMs(restored?.startedAt ?? 0, now))).toBe('00:25:07');
    } finally {
      jest.useRealTimers();
    }
  });
});
