import { outboxKey } from '@/sync/outbox';
import { makeFolder, makeRoutine } from '@/test/routines';

import { createMemoryRoutineRepo } from '../repo';
import { syncRoutines, type RoutinesApi } from '../sync';

describe('syncRoutines', () => {
  it('replaces the local copy with the server’s', async () => {
    const repo = createMemoryRoutineRepo({ routines: [makeRoutine({ name: 'Old' })] });
    const api: RoutinesApi = {
      listRoutines: jest
        .fn()
        .mockResolvedValue({ items: [makeRoutine({ name: 'New' })], routine_limit: 4 }),
      listFolders: jest.fn().mockResolvedValue([makeFolder({ name: 'Upper' })]),
    };

    await syncRoutines(repo, api);

    const local = await repo.load();
    expect(local.routines.map((r) => r.name)).toEqual(['New']);
    expect(local.folders.map((f) => f.name)).toEqual(['Upper']);
    expect(local.limit).toBe(4);
  });

  it('keeps rows with queued changes as they are on the device', async () => {
    const edited = makeRoutine({ name: 'Edited here' });
    const created = makeRoutine({ name: 'Made offline' });
    const deletedHere = makeRoutine({ name: 'Deleted here' });
    const repo = createMemoryRoutineRepo({ routines: [edited, created] });
    const api: RoutinesApi = {
      listRoutines: jest.fn().mockResolvedValue({
        items: [{ ...edited, name: 'Server name' }, deletedHere, makeRoutine({ name: 'Other' })],
        routine_limit: 4,
      }),
      listFolders: jest.fn().mockResolvedValue([]),
    };
    const pending = new Set([edited, created, deletedHere].map((r) => outboxKey('routine', r.id)));

    await syncRoutines(repo, api, async () => pending);

    expect((await repo.load()).routines.map((r) => r.name).sort()).toEqual([
      'Edited here',
      'Made offline',
      'Other',
    ]);
  });

  it('keeps the local copy when offline', async () => {
    const repo = createMemoryRoutineRepo({ routines: [makeRoutine({ name: 'Kept' })], limit: 4 });
    const api: RoutinesApi = {
      listRoutines: jest.fn().mockRejectedValue(new TypeError('Network request failed')),
      listFolders: jest.fn().mockResolvedValue([]),
    };

    await expect(syncRoutines(repo, api)).rejects.toThrow('Network request failed');
    expect((await repo.load()).routines.map((r) => r.name)).toEqual(['Kept']);
  });
});

describe('memory repo', () => {
  it('upserts and removes', async () => {
    const repo = createMemoryRoutineRepo();
    const push = makeRoutine({ name: 'Push' });
    const folder = makeFolder({ name: 'Upper' });

    await repo.putRoutines([push, makeRoutine({ name: 'Pull' })]);
    await repo.putRoutines([{ ...push, version: 2 }]);
    await repo.putFolders([folder]);
    await repo.removeRoutine('r-pull');
    expect((await repo.load()).routines).toEqual([{ ...push, version: 2 }]);

    await repo.removeFolder(folder.id);
    await repo.clear();
    expect(await repo.load()).toEqual({ routines: [], folders: [], limit: null });
  });
});
