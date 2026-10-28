import { ApiError } from '@/api/client';
import type { SyncChange, SyncEntity, SyncPull, SyncPulled, SyncResult } from '@/api/types';

import { backoffMs, PUSH_BATCH, SyncEngine, type LocalStore, type SyncApi } from '../engine';
import { createMemoryCursor, createMemoryOutbox, type QueuedChange } from '../outbox';

const T0 = Date.UTC(2026, 9, 27, 18, 0, 0);
const offline = () => new ApiError(0, 'network_error', 'Network request failed');

function upsert(
  entityId: string,
  data: Record<string, unknown> = { name: entityId },
): QueuedChange {
  return { entity: 'routine', entityId, op: 'upsert', data, baseVersion: null };
}

/**
 * A server that stores rows by id, like the real one: an upsert of a known id updates it,
 * so a retried push never creates a second row.
 */
function fakeServer() {
  const rows = new Map<string, { data: Record<string, unknown>; version: number }>();
  const changes: SyncPulled[] = [];
  let seq = 0;
  const server = {
    rows,
    creates: 0,
    /** Answer this many pushes with a network error before reaching the server. */
    failNext: 0,
    /** Apply the next push, then lose the response (the phone sees a network error). */
    loseNextResponse: false,
    answer: null as ((change: SyncChange) => SyncResult | null) | null,
    api: {
      push: jest.fn(async (batch: SyncChange[]): Promise<SyncResult[]> => {
        if (server.failNext > 0) {
          server.failNext -= 1;
          throw offline();
        }
        const results = batch.map((change): SyncResult => {
          const custom = server.answer?.(change);
          if (custom) return custom;
          const existing = rows.get(change.id);
          if (change.op === 'delete') {
            rows.delete(change.id);
            return { ...base(change), status: 'applied', deleted: true, data: null };
          }
          if (!existing) server.creates += 1;
          const row = { data: change.data ?? {}, version: (existing?.version ?? 0) + 1 };
          rows.set(change.id, row);
          seq += 1;
          const data = { id: change.id, ...row.data, version: row.version };
          changes.push({
            entity: change.entity,
            id: change.id,
            change_seq: seq,
            deleted: false,
            data,
          });
          return { ...base(change), status: 'applied', deleted: false, data };
        });
        if (server.loseNextResponse) {
          server.loseNextResponse = false;
          throw offline();
        }
        return results;
      }),
      pull: jest.fn(async (since: number, limit: number): Promise<SyncPull> => {
        const after = changes.filter((c) => c.change_seq > since);
        const page = after.slice(0, limit);
        return {
          changes: page,
          cursor: page.at(-1)?.change_seq ?? since,
          has_more: after.length > limit,
        };
      }),
    } satisfies SyncApi,
    /** A change made on another device. */
    remoteChange(entity: SyncEntity, id: string, data: Record<string, unknown> | null) {
      seq += 1;
      changes.push({ entity, id, change_seq: seq, deleted: data === null, data });
    },
  };
  return server;
}

function base(change: SyncChange) {
  return { entity: change.entity, id: change.id, error: null };
}

function memoryLocal() {
  const rows = new Map<string, unknown>();
  const local: LocalStore & { rows: Map<string, unknown> } = {
    rows,
    apply: jest.fn(async (_entity, id, data) => {
      if (data === null) rows.delete(id);
      else rows.set(id, data);
    }),
  };
  return local;
}

function setup(clock = { now: T0 }) {
  const outbox = createMemoryOutbox();
  const server = fakeServer();
  const local = memoryLocal();
  const cursor = createMemoryCursor();
  const engine = new SyncEngine({
    outbox,
    api: server.api,
    local,
    cursor,
    now: () => clock.now,
    random: () => 1,
  });
  return { outbox, server, local, cursor, engine, clock };
}

describe('backoff', () => {
  it.each([
    [1, 5_000],
    [2, 10_000],
    [3, 20_000],
    [7, 300_000],
    [20, 300_000],
  ])('waits up to %i failures → %i ms', (attempts, ms) => {
    expect(backoffMs(attempts, () => 1)).toBe(ms);
    // Jitter only shortens the wait, never below half.
    expect(backoffMs(attempts, () => 0)).toBe(ms / 2);
  });
});

describe('pushing', () => {
  it('sends queued changes in order and replaces local rows with the server copy', async () => {
    const { outbox, server, local, engine } = setup();
    await outbox.enqueue(upsert('a'), T0);
    await outbox.enqueue(upsert('b'), T0);

    expect(await engine.sync()).toBe('synced');

    expect(server.api.push).toHaveBeenCalledTimes(1);
    expect(server.api.push.mock.calls[0]?.[0].map((c) => c.id)).toEqual(['a', 'b']);
    expect(server.api.push.mock.calls[0]?.[0][0]).toEqual({
      entity: 'routine',
      id: 'a',
      op: 'upsert',
      base_version: null,
      updated_at: new Date(T0).toISOString(),
      data: { name: 'a' },
    });
    expect(await outbox.count()).toBe(0);
    expect(local.rows.get('a')).toEqual({ id: 'a', name: 'a', version: 1 });
  });

  it('logged in airplane mode, saved exactly once when back online', async () => {
    const { outbox, server, engine, clock } = setup();
    server.failNext = 1;
    await outbox.enqueue(upsert('workout-1'), T0);

    expect(await engine.sync()).toBe('offline');
    expect(outbox.items[0]).toMatchObject({ attempts: 1, nextTryAt: T0 + 5_000 });
    // Not retried before the backoff is over…
    clock.now = T0 + 1_000;
    await engine.sync();
    expect(server.api.push).toHaveBeenCalledTimes(1);

    // …unless the network comes back, which sends at once. The response is lost on the way.
    server.loseNextResponse = true;
    expect(await engine.sync({ force: true })).toBe('offline');
    expect(server.rows.has('workout-1')).toBe(true);
    expect(await outbox.count()).toBe(1);

    // The retry reaches the server again: still one workout there.
    expect(await engine.sync({ force: true })).toBe('synced');
    expect(server.creates).toBe(1);
    expect(await outbox.count()).toBe(0);
  });

  it('sends a large queue in batches', async () => {
    const { outbox, server, engine } = setup();
    for (let i = 0; i < PUSH_BATCH + 3; i += 1) await outbox.enqueue(upsert(`r${i}`), T0);

    await engine.sync();

    expect(server.api.push.mock.calls.map((call) => call[0].length)).toEqual([PUSH_BATCH, 3]);
  });

  it('keeps an edit made while its older state was being sent, rebased on the new version', async () => {
    const { outbox, server, local, engine } = setup();
    await outbox.enqueue(upsert('a', { name: 'first' }), T0);
    server.answer = (change) => {
      // The user edits again while this push is in flight.
      void outbox.enqueue(upsert('a', { name: 'second' }), T0);
      server.answer = null;
      return {
        ...base(change),
        status: 'applied',
        deleted: false,
        data: { id: 'a', name: 'first', version: 4 },
      };
    };

    await engine.sync();

    // Sent again with the newer state, based on the version the first push produced.
    expect(server.api.push).toHaveBeenCalledTimes(2);
    expect(server.api.push.mock.calls[1]?.[0][0]).toMatchObject({
      base_version: 4,
      data: { name: 'second' },
    });
    expect(local.rows.get('a')).toMatchObject({ name: 'second' });
  });

  it('takes the server copy when an edit lost a conflict', async () => {
    const { outbox, server, local, engine } = setup();
    await outbox.enqueue(upsert('a', { name: 'mine' }), T0);
    server.answer = (change) => ({
      ...base(change),
      status: 'stale',
      deleted: false,
      data: { id: 'a', name: 'theirs', version: 7 },
    });

    await engine.sync();

    expect(local.rows.get('a')).toEqual({ id: 'a', name: 'theirs', version: 7 });
    expect(await outbox.count()).toBe(0);
  });

  it('drops a refused new routine and tells the user', async () => {
    const { outbox, server, local, engine } = setup();
    const notices = jest.fn();
    engine.onNotice(notices);
    local.rows.set('r', { id: 'r' });
    await outbox.enqueue(upsert('r'), T0);
    server.answer = (change) => ({
      ...base(change),
      status: 'rejected',
      deleted: true,
      data: null,
      error: { code: 'routine_limit_reached', message: 'Free accounts can keep 4', details: null },
    });

    await engine.sync();

    expect(local.rows.has('r')).toBe(false);
    expect(await outbox.count()).toBe(0);
    expect(notices).toHaveBeenCalledWith([
      {
        entity: 'routine',
        id: 'r',
        code: 'routine_limit_reached',
        message: 'Free accounts can keep 4',
      },
    ]);
  });

  it('never drops a finished workout the server refused, unless it was deleted elsewhere', async () => {
    const { outbox, server, local, engine } = setup();
    local.rows.set('kept', { id: 'kept' });
    local.rows.set('gone', { id: 'gone' });
    await outbox.enqueue({ ...upsert('kept'), entity: 'workout' }, T0);
    await outbox.enqueue({ ...upsert('gone'), entity: 'workout' }, T0);
    server.answer = (change) => ({
      ...base(change),
      status: 'rejected',
      deleted: true,
      data: null,
      error: {
        code: change.id === 'gone' ? 'workout_deleted' : 'validation_error',
        message: 'no',
        details: null,
      },
    });

    await engine.sync();

    expect(local.rows.has('kept')).toBe(true);
    expect(local.rows.has('gone')).toBe(false);
    expect(await outbox.count()).toBe(0);
  });

  it('restores the server copy when a workout is too old to change', async () => {
    const { outbox, server, local, engine } = setup();
    await outbox.enqueue({ ...upsert('w', { title: 'Renamed' }), entity: 'workout' }, T0);
    server.answer = (change) => ({
      ...base(change),
      status: 'rejected',
      deleted: false,
      data: { id: 'w', title: 'Original', version: 2 },
      error: { code: 'workout_immutable', message: 'too old', details: null },
    });

    await engine.sync();

    expect(local.rows.get('w')).toMatchObject({ title: 'Original' });
  });

  it('stops without backoff when the session has ended', async () => {
    const { outbox, server, engine } = setup();
    await outbox.enqueue(upsert('a'), T0);
    server.api.push.mockRejectedValueOnce(new ApiError(401, 'invalid_token', 'no'));

    expect(await engine.sync()).toBe('signedOut');
    expect(outbox.items[0]).toMatchObject({ attempts: 0, nextTryAt: T0 });
  });

  it('reports a server error as failed and backs off', async () => {
    const { outbox, server, engine } = setup();
    await outbox.enqueue(upsert('a'), T0);
    server.api.push.mockRejectedValueOnce(new ApiError(500, 'internal_error', 'boom'));

    expect(await engine.sync()).toBe('failed');
    expect(outbox.items[0]).toMatchObject({ attempts: 1, nextTryAt: T0 + 5_000 });
  });
});

describe('pulling', () => {
  it('applies remote changes after the cursor, page by page', async () => {
    const { server, local, cursor, engine } = setup();
    for (let i = 0; i < 205; i += 1) server.remoteChange('routine', `r${i}`, { name: `R${i}` });
    server.remoteChange('routine', 'r0', null);

    await engine.sync();

    expect(server.api.pull.mock.calls.map((call) => call[0])).toEqual([0, 200]);
    expect(local.rows.size).toBe(204);
    expect(local.rows.has('r0')).toBe(false);
    expect(cursor.value).toBe(206);

    await engine.sync();
    expect(server.api.pull).toHaveBeenLastCalledWith(206, 200);
  });

  it('leaves rows with queued edits alone', async () => {
    const { outbox, server, local, engine } = setup();
    server.failNext = 1;
    await outbox.enqueue(upsert('mine', { name: 'local edit' }), T0);
    local.rows.set('mine', { name: 'local edit' });
    server.remoteChange('routine', 'mine', { name: 'remote' });
    server.remoteChange('routine', 'other', { name: 'remote' });
    await engine.sync();
    // Offline for the push, so nothing was pulled either.
    expect(server.api.pull).not.toHaveBeenCalled();

    server.api.push.mockRejectedValueOnce(offline());
    // Pull alone (push failing again) must not clobber the queued edit.
    await engine.sync({ force: true });
    expect(server.api.pull).not.toHaveBeenCalled();
  });

  it('skips a pulled row that is still queued', async () => {
    const { outbox, server, local, cursor, engine } = setup();
    server.remoteChange('routine', 'mine', { name: 'remote' });
    server.remoteChange('routine', 'other', { name: 'remote' });
    // Queued after a push started; only pull runs on an empty due list.
    await outbox.enqueue(upsert('mine', { name: 'local edit' }), T0 + 60_000);
    local.rows.set('mine', { name: 'local edit' });

    await engine.sync();

    expect(local.rows.get('mine')).toEqual({ name: 'local edit' });
    expect(local.rows.get('other')).toEqual({ name: 'remote' });
    expect(cursor.value).toBe(2);
  });
});

describe('running', () => {
  it('shares one run between callers and runs once more for a change made meanwhile', async () => {
    const { outbox, server, engine } = setup();
    await outbox.enqueue(upsert('a'), T0);

    const first = engine.sync();
    const second = engine.sync();
    await outbox.enqueue(upsert('b'), T0);
    await Promise.all([first, second]);

    expect(server.api.push.mock.calls.map((call) => call[0].map((c) => c.id))).toEqual([
      ['a'],
      ['b'],
    ]);
  });

  it('tells listeners which entities changed', async () => {
    const { outbox, server, engine } = setup();
    const changed = jest.fn();
    const stop = engine.onChanged(changed);
    await outbox.enqueue(upsert('a'), T0);
    server.remoteChange('workout', 'w', { id: 'w' });

    await engine.sync();
    stop();
    await engine.sync();

    expect(changed).toHaveBeenCalledTimes(1);
    expect([...(changed.mock.calls[0]?.[0] as Set<string>)].sort()).toEqual(['routine', 'workout']);
  });

  it('applies nothing after a cancel (sign-out mid-sync)', async () => {
    const { outbox, server, local, engine } = setup();
    await outbox.enqueue(upsert('a'), T0);
    server.api.push.mockImplementationOnce(async (batch) => {
      engine.cancel();
      return batch.map((change) => ({
        ...base(change),
        status: 'applied' as const,
        deleted: false,
        data: { id: change.id },
      }));
    });

    expect(await engine.sync()).toBe('cancelled');
    expect(local.apply).not.toHaveBeenCalled();
  });
});
