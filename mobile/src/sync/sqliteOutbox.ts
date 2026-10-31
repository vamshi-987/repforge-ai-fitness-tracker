import { and, asc, count, eq, inArray, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { outbox, syncState } from '@/db/schema';

import { coalesce, outboxKey, type CursorStore, type OutboxItem, type OutboxRepo } from './outbox';

type Row = typeof outbox.$inferSelect;

const toItem = (row: Row): OutboxItem => ({ ...row, data: row.data ?? null });

/** The outbox in SQLite. Drizzle's expo driver is synchronous, so each call is atomic. */
export const sqliteOutbox: OutboxRepo = {
  async enqueue(change, now) {
    db.transaction((tx) => {
      const existing = tx
        .select()
        .from(outbox)
        .where(and(eq(outbox.entity, change.entity), eq(outbox.entityId, change.entityId)))
        .get();
      if (existing) {
        const next = coalesce(toItem(existing), change, now);
        tx.update(outbox).set(next).where(eq(outbox.id, existing.id)).run();
        return;
      }
      tx.insert(outbox)
        .values({ ...change, updatedAt: now, revision: 1, attempts: 0, nextTryAt: now })
        .run();
    });
  },

  async due(now, limit) {
    return db
      .select()
      .from(outbox)
      .where(lte(outbox.nextTryAt, now))
      .orderBy(asc(outbox.id))
      .limit(limit)
      .all()
      .map(toItem);
  },

  async settle(id, revision) {
    const result = db
      .delete(outbox)
      .where(and(eq(outbox.id, id), eq(outbox.revision, revision)))
      .run();
    return result.changes > 0;
  },

  async rebase(id, version) {
    db.update(outbox).set({ baseVersion: version }).where(eq(outbox.id, id)).run();
  },

  async retryLater(ids, nextTryAt) {
    if (ids.length === 0) return;
    db.update(outbox)
      .set({ attempts: sql`${outbox.attempts} + 1`, nextTryAt })
      .where(inArray(outbox.id, ids))
      .run();
  },

  async pendingKeys() {
    const rows = db.select({ entity: outbox.entity, id: outbox.entityId }).from(outbox).all();
    return new Set(rows.map((row) => outboxKey(row.entity, row.id)));
  },

  async count() {
    return db.select({ n: count() }).from(outbox).get()?.n ?? 0;
  },

  async clear() {
    db.delete(outbox).run();
  },
};

// Bumped whenever the app starts syncing a new entity, so a phone that already synced pulls
// once from 0 and receives the rows of the new entities that predate its cursor
// (v2: body weights and measurements; v3: water).
const CURSOR_KEY = 'sync:cursor:v3';

export const sqliteCursor: CursorStore = {
  async get() {
    const value = db.select().from(syncState).where(eq(syncState.key, CURSOR_KEY)).get()?.value;
    return value === undefined ? 0 : Number(value);
  },
  async set(cursor) {
    const row = { key: CURSOR_KEY, value: String(cursor), updatedAt: new Date() };
    db.insert(syncState).values(row).onConflictDoUpdate({ target: syncState.key, set: row }).run();
  },
  async clear() {
    db.delete(syncState).where(eq(syncState.key, CURSOR_KEY)).run();
  },
};
