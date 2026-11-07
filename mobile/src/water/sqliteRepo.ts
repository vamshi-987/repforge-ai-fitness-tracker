import { and, asc, eq, gte, lt } from 'drizzle-orm';

import { db } from '@/db/client';
import { waterLogs } from '@/db/schema';

import type { WaterRepo } from './repo';

export const sqliteWaterRepo: WaterRepo = {
  async between(start, end) {
    return db
      .select()
      .from(waterLogs)
      .where(and(gte(waterLogs.loggedAt, start), lt(waterLogs.loggedAt, end)))
      .orderBy(asc(waterLogs.loggedAt))
      .all()
      .map((r) => {
        const at = new Date(r.loggedAt).toISOString();
        return {
          id: r.id,
          logged_at: at,
          amount_ml: r.amountMl,
          version: r.version,
          created_at: at,
          updated_at: at,
        };
      });
  },
  async put(row) {
    const values = {
      id: row.id,
      loggedAt: Date.parse(row.logged_at),
      amountMl: row.amount_ml,
      version: row.version,
    };
    db.insert(waterLogs)
      .values(values)
      .onConflictDoUpdate({ target: waterLogs.id, set: values })
      .run();
  },
  async remove(id) {
    db.delete(waterLogs).where(eq(waterLogs.id, id)).run();
  },
  async clear() {
    db.delete(waterLogs).run();
  },
};
