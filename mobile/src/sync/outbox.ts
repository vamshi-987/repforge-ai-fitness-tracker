import type { SyncEntity, SyncOp } from '@/api/types';

/** A change made on the device that the server hasn't confirmed yet. */
export interface OutboxItem {
  /** Queue order: the server applies changes in this order. */
  id: number;
  entity: SyncEntity;
  entityId: string;
  op: SyncOp;
  /** The row's full state for an upsert; null for a delete. */
  data: Record<string, unknown> | null;
  /** The server version the pending edits started from; null for a row made on the device. */
  baseVersion: number | null;
  /** Epoch ms of the latest local edit. */
  updatedAt: number;
  /** Goes up on every edit, so a reply to an older push can't settle a newer edit. */
  revision: number;
  attempts: number;
  /** Epoch ms; not pushed before this (backoff after a failure). */
  nextTryAt: number;
}

export interface QueuedChange {
  entity: SyncEntity;
  entityId: string;
  op: SyncOp;
  data: Record<string, unknown> | null;
  baseVersion: number | null;
}

/**
 * The device's queue of unsent changes, one item per row. Editing a row that is already
 * queued replaces the queued state *in place*, so it keeps its turn: a custom exercise
 * created before a routine that uses it is still sent first after both are edited.
 */
export interface OutboxRepo {
  enqueue(change: QueuedChange, now: number): Promise<void>;
  /** Items ready to send, in queue order. */
  due(now: number, limit: number): Promise<OutboxItem[]>;
  /** Remove an answered item unless it was edited again meanwhile. True if removed. */
  settle(id: number, revision: number): Promise<boolean>;
  /** The server took an older state of this item: newer edits now start from `version`. */
  rebase(id: number, version: number): Promise<void>;
  /** A send failed: try these again from `nextTryAt`. */
  retryLater(ids: number[], nextTryAt: number): Promise<void>;
  /** `entity:id` of every queued row; pulls must not overwrite them. */
  pendingKeys(): Promise<Set<string>>;
  count(): Promise<number>;
  clear(): Promise<void>;
}

export function outboxKey(entity: SyncEntity, id: string): string {
  return `${entity}:${id}`;
}

/** Shared by both implementations: the queued state after another edit of the same row. */
export function coalesce(existing: OutboxItem, change: QueuedChange, now: number): OutboxItem {
  return {
    ...existing,
    op: change.op,
    data: change.data,
    // The pending edits still start from the version the first one did.
    baseVersion: existing.baseVersion,
    updatedAt: now,
    revision: existing.revision + 1,
    attempts: 0,
    nextTryAt: now,
  };
}

export function createMemoryOutbox(): OutboxRepo & { items: OutboxItem[] } {
  const items: OutboxItem[] = [];
  let nextId = 1;
  const find = (id: number) => items.find((item) => item.id === id);
  return {
    items,
    async enqueue(change, now) {
      const index = items.findIndex(
        (i) => i.entity === change.entity && i.entityId === change.entityId,
      );
      const existing = items[index];
      if (existing) {
        items[index] = coalesce(existing, change, now);
        return;
      }
      items.push({
        ...change,
        id: nextId++,
        updatedAt: now,
        revision: 1,
        attempts: 0,
        nextTryAt: now,
      });
    },
    async due(now, limit) {
      return items
        .filter((i) => i.nextTryAt <= now)
        .slice(0, limit)
        .map((i) => ({ ...i }));
    },
    async settle(id, revision) {
      const index = items.findIndex((i) => i.id === id && i.revision === revision);
      if (index < 0) return false;
      items.splice(index, 1);
      return true;
    },
    async rebase(id, version) {
      const item = find(id);
      if (item) item.baseVersion = version;
    },
    async retryLater(ids, nextTryAt) {
      for (const id of ids) {
        const item = find(id);
        if (item) {
          item.attempts += 1;
          item.nextTryAt = nextTryAt;
        }
      }
    },
    async pendingKeys() {
      return new Set(items.map((i) => outboxKey(i.entity, i.entityId)));
    },
    async count() {
      return items.length;
    },
    async clear() {
      items.splice(0, items.length);
    },
  };
}

/** Where the last pull stopped. */
export interface CursorStore {
  get(): Promise<number>;
  set(cursor: number): Promise<void>;
  clear(): Promise<void>;
}

export function createMemoryCursor(start = 0): CursorStore & { value: number } {
  const store = {
    value: start,
    async get() {
      return store.value;
    },
    async set(cursor: number) {
      store.value = cursor;
    },
    async clear() {
      store.value = 0;
    },
  };
  return store;
}
