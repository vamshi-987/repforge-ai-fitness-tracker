import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { routineFolders, routines, syncState } from '@/db/schema';

import type { RoutineRepo } from './repo';

const LIMIT_KEY = 'routines:limit';

/** The routines mirror in SQLite; every write is one synchronous transaction. */
export const sqliteRoutineRepo: RoutineRepo = {
  async load() {
    const limit = db.select().from(syncState).where(eq(syncState.key, LIMIT_KEY)).get()?.value;
    return {
      routines: db
        .select()
        .from(routines)
        .all()
        .map((row) => row.payload),
      folders: db
        .select()
        .from(routineFolders)
        .all()
        .map((row) => row.payload),
      limit: limit === undefined || limit === 'null' ? null : Number(limit),
    };
  },

  async replaceAll(data) {
    db.transaction((tx) => {
      tx.delete(routines).run();
      tx.delete(routineFolders).run();
      for (const routine of data.routines)
        tx.insert(routines).values({ id: routine.id, payload: routine }).run();
      for (const folder of data.folders)
        tx.insert(routineFolders).values({ id: folder.id, payload: folder }).run();
      const row = { key: LIMIT_KEY, value: String(data.limit), updatedAt: new Date() };
      tx.insert(syncState)
        .values(row)
        .onConflictDoUpdate({ target: syncState.key, set: row })
        .run();
    });
  },

  async putRoutines(rows) {
    db.transaction((tx) => {
      for (const routine of rows) {
        const values = { id: routine.id, payload: routine };
        tx.insert(routines)
          .values(values)
          .onConflictDoUpdate({ target: routines.id, set: values })
          .run();
      }
    });
  },

  async removeRoutine(id) {
    db.delete(routines).where(eq(routines.id, id)).run();
  },

  async putFolders(rows) {
    db.transaction((tx) => {
      for (const folder of rows) {
        const values = { id: folder.id, payload: folder };
        tx.insert(routineFolders)
          .values(values)
          .onConflictDoUpdate({ target: routineFolders.id, set: values })
          .run();
      }
    });
  },

  async removeFolder(id) {
    db.delete(routineFolders).where(eq(routineFolders.id, id)).run();
  },

  async clear() {
    db.transaction((tx) => {
      tx.delete(routines).run();
      tx.delete(routineFolders).run();
      tx.delete(syncState).where(eq(syncState.key, LIMIT_KEY)).run();
    });
  },
};
