import { createMemoryCursor, createMemoryOutbox, outboxKey, type QueuedChange } from '../outbox';

const T0 = 1_000;

const change = (entityId: string, overrides: Partial<QueuedChange> = {}): QueuedChange => ({
  entity: 'routine',
  entityId,
  op: 'upsert',
  data: { name: entityId },
  baseVersion: 3,
  ...overrides,
});

describe('memory outbox', () => {
  it('keeps one item per row, in the queue position of its first change', async () => {
    const outbox = createMemoryOutbox();
    await outbox.enqueue(change('exercise-x', { entity: 'exercise' }), T0);
    await outbox.enqueue(change('routine-using-x'), T0);
    await outbox.enqueue(
      change('exercise-x', { entity: 'exercise', data: { name: 'v2' } }),
      T0 + 5,
    );

    const items = await outbox.due(T0 + 5, 10);

    expect(items.map((i) => [i.entityId, i.revision])).toEqual([
      ['exercise-x', 2],
      ['routine-using-x', 1],
    ]);
    expect(items[0]).toMatchObject({ data: { name: 'v2' }, updatedAt: T0 + 5 });
  });

  it('keeps the base version of the first pending edit, and turns an edit into a delete', async () => {
    const outbox = createMemoryOutbox();
    await outbox.enqueue(change('r'), T0);
    await outbox.enqueue(change('r', { op: 'delete', data: null, baseVersion: null }), T0 + 1);

    expect(outbox.items[0]).toMatchObject({ op: 'delete', data: null, baseVersion: 3 });
  });

  it('settles only the revision that was sent', async () => {
    const outbox = createMemoryOutbox();
    await outbox.enqueue(change('r'), T0);
    const [sent] = await outbox.due(T0, 10);
    await outbox.enqueue(change('r', { data: { name: 'newer' } }), T0 + 1);

    expect(await outbox.settle(sent!.id, sent!.revision)).toBe(false);
    await outbox.rebase(sent!.id, 4);
    expect(outbox.items[0]).toMatchObject({ baseVersion: 4, revision: 2 });
    expect(await outbox.settle(sent!.id, 2)).toBe(true);
    expect(await outbox.count()).toBe(0);
  });

  it('holds failed items back until their retry time, and a new edit resets that', async () => {
    const outbox = createMemoryOutbox();
    await outbox.enqueue(change('a'), T0);
    await outbox.enqueue(change('b'), T0);
    await outbox.retryLater([1, 2], T0 + 5_000);

    expect(await outbox.due(T0 + 4_999, 10)).toEqual([]);
    expect(outbox.items.map((i) => i.attempts)).toEqual([1, 1]);
    await outbox.enqueue(change('b', { data: { name: 'edited' } }), T0 + 10);
    expect((await outbox.due(T0 + 10, 10)).map((i) => [i.entityId, i.attempts])).toEqual([
      ['b', 0],
    ]);
  });

  it('lists pending rows and clears', async () => {
    const outbox = createMemoryOutbox();
    await outbox.enqueue(change('a'), T0);
    await outbox.enqueue(change('w', { entity: 'workout' }), T0);

    expect(await outbox.pendingKeys()).toEqual(
      new Set([outboxKey('routine', 'a'), outboxKey('workout', 'w')]),
    );
    await outbox.clear();
    expect(await outbox.count()).toBe(0);
  });
});

describe('memory cursor', () => {
  it('stores and forgets the cursor', async () => {
    const cursor = createMemoryCursor(7);
    await cursor.set(42);
    expect(await cursor.get()).toBe(42);
    await cursor.clear();
    expect(await cursor.get()).toBe(0);
  });
});
