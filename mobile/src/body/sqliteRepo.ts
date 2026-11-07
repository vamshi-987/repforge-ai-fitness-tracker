import { desc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { bodyMeasurements, bodyWeights } from '@/db/schema';

import type { BodyRepo } from './repo';

// The server's timestamps carry no fractional part we need; the API takes any ISO time.
const iso = (ms: number) => new Date(ms).toISOString();

export const sqliteBodyRepo: BodyRepo = {
  async weights() {
    return db
      .select()
      .from(bodyWeights)
      .orderBy(desc(bodyWeights.measuredAt))
      .all()
      .map((r) => ({
        id: r.id,
        measured_at: iso(r.measuredAt),
        weight_kg: r.weightKg,
        source: r.source,
        version: r.version,
        created_at: iso(r.measuredAt),
        updated_at: iso(r.measuredAt),
      }));
  },
  async putWeight(row) {
    const values = {
      id: row.id,
      measuredAt: Date.parse(row.measured_at),
      weightKg: row.weight_kg,
      source: row.source,
      version: row.version,
    };
    db.insert(bodyWeights)
      .values(values)
      .onConflictDoUpdate({ target: bodyWeights.id, set: values })
      .run();
  },
  async removeWeight(id) {
    db.delete(bodyWeights).where(eq(bodyWeights.id, id)).run();
  },
  async measurements() {
    return db
      .select()
      .from(bodyMeasurements)
      .orderBy(desc(bodyMeasurements.measuredAt))
      .all()
      .map((r) => ({
        id: r.id,
        measured_at: iso(r.measuredAt),
        kind: r.kind,
        value: r.value,
        version: r.version,
        created_at: iso(r.measuredAt),
        updated_at: iso(r.measuredAt),
      }));
  },
  async putMeasurement(row) {
    const values = {
      id: row.id,
      measuredAt: Date.parse(row.measured_at),
      kind: row.kind,
      value: row.value,
      version: row.version,
    };
    db.insert(bodyMeasurements)
      .values(values)
      .onConflictDoUpdate({ target: bodyMeasurements.id, set: values })
      .run();
  },
  async removeMeasurement(id) {
    db.delete(bodyMeasurements).where(eq(bodyMeasurements.id, id)).run();
  },
  async clear() {
    db.transaction((tx) => {
      tx.delete(bodyWeights).run();
      tx.delete(bodyMeasurements).run();
    });
  },
};
