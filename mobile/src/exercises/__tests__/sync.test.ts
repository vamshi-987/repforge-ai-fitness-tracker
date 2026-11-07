import { ApiError, type ApiResponse } from '@/api/client';
import type { Equipment, ExercisePage, Muscle } from '@/api/types';
import { outboxKey } from '@/sync/outbox';
import { BENCH, EQUIPMENT, EXERCISES, MUSCLES, makeExercise } from '@/test/library';

import { createMemoryRepo } from '../repo';
import { ETAG_KEYS, syncLibrary, type LibraryApi } from '../sync';

const ok = <T>(data: T, etag: string): ApiResponse<T> => ({ status: 200, data, etag });
const notModified = <T>(etag: string): ApiResponse<T> => ({ status: 304, data: null, etag });

function fakeApi(pages: ExercisePage[] = [{ items: EXERCISES, next_cursor: null }]) {
  const calls: string[] = [];
  const api: LibraryApi = {
    listMuscles: jest.fn(async (etag: string | null): Promise<ApiResponse<Muscle[]>> => {
      calls.push(`muscles:${etag}`);
      return etag === 'm1' ? notModified('m1') : ok(MUSCLES, 'm1');
    }),
    listEquipment: jest.fn(async (etag: string | null): Promise<ApiResponse<Equipment[]>> => {
      calls.push(`equipment:${etag}`);
      return etag === 'q1' ? notModified('q1') : ok(EQUIPMENT, 'q1');
    }),
    listExercisePage: jest.fn(
      async (cursor: string | null, etag: string | null): Promise<ApiResponse<ExercisePage>> => {
        calls.push(`exercises:${cursor}:${etag}`);
        if (etag === 'x1') return notModified('x1');
        const index = cursor ? Number(cursor) : 0;
        return ok(pages[index] as ExercisePage, 'x1');
      },
    ),
  };
  return { api, calls };
}

describe('syncLibrary', () => {
  it('keeps custom exercises with queued changes as they are on the device', async () => {
    const mine = makeExercise({ id: 'mine', name: 'Made offline', is_custom: true });
    const edited = makeExercise({ id: 'edited', name: 'Edited here', is_custom: true });
    const repo = createMemoryRepo({ exercises: [mine, edited] });
    const { api } = fakeApi([
      { items: [BENCH, { ...edited, name: 'Server name' }], next_cursor: null },
    ]);
    const pending = new Set([outboxKey('exercise', 'mine'), outboxKey('exercise', 'edited')]);

    await syncLibrary(repo, api, async () => pending);

    expect((await repo.load()).exercises.map((e) => e.name).sort()).toEqual(
      [BENCH.name, 'Edited here', 'Made offline'].sort(),
    );
  });

  it('downloads everything once, then revalidates with ETags', async () => {
    const repo = createMemoryRepo();
    const { api, calls } = fakeApi();

    await expect(syncLibrary(repo, api)).resolves.toBe(true);
    await expect(syncLibrary(repo, api)).resolves.toBe(false);

    const local = await repo.load();
    expect(local.exercises).toHaveLength(EXERCISES.length);
    expect(local.muscles).toEqual(MUSCLES);
    expect(local.equipment).toEqual(EQUIPMENT);
    expect(await repo.getMeta(ETAG_KEYS.exercises)).toBe('x1');
    expect(calls).toEqual([
      'muscles:null',
      'equipment:null',
      'exercises:null:null',
      'muscles:m1',
      'equipment:q1',
      'exercises:null:x1',
    ]);
  });

  it('follows cursors when the library spans several pages', async () => {
    const repo = createMemoryRepo();
    const { api } = fakeApi([
      { items: EXERCISES.slice(0, 3), next_cursor: '1' },
      { items: EXERCISES.slice(3), next_cursor: null },
    ]);

    await syncLibrary(repo, api);

    expect((await repo.load()).exercises.map((e) => e.id)).toEqual(EXERCISES.map((e) => e.id));
  });

  it('keeps the local copy when offline', async () => {
    const repo = createMemoryRepo({ exercises: [BENCH] });
    const api: LibraryApi = {
      ...fakeApi().api,
      listMuscles: jest.fn().mockRejectedValue(new ApiError(0, 'network_error', 'offline')),
    };

    await expect(syncLibrary(repo, api)).rejects.toMatchObject({ code: 'network_error' });
    expect((await repo.load()).exercises).toEqual([BENCH]);
  });
});

describe('memory repo', () => {
  it('puts, removes and drops custom exercises', async () => {
    const custom = { ...BENCH, id: 'mine', is_custom: true };
    const repo = createMemoryRepo({ exercises: [BENCH] });

    await repo.putExercise(custom);
    await repo.putExercise({ ...custom, name: 'Renamed' });
    expect((await repo.load()).exercises.map((e) => e.name)).toEqual([BENCH.name, 'Renamed']);

    await repo.removeCustomExercises();
    expect((await repo.load()).exercises).toEqual([BENCH]);

    await repo.removeExercise(BENCH.id);
    await repo.setMeta('k', 'v');
    await repo.setMeta('k', null);
    expect(await repo.load()).toMatchObject({ exercises: [] });
    expect(await repo.getMeta('k')).toBeNull();
  });
});
