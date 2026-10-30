import type { BodyMeasurement, BodyWeight } from '@/api/types';

/** The device's weigh-ins and measurements (synced). SQLite in the app, memory in tests. */
export interface BodyRepo {
  /** Newest first. */
  weights(): Promise<BodyWeight[]>;
  putWeight(row: BodyWeight): Promise<void>;
  removeWeight(id: string): Promise<void>;
  /** Newest first. */
  measurements(): Promise<BodyMeasurement[]>;
  putMeasurement(row: BodyMeasurement): Promise<void>;
  removeMeasurement(id: string): Promise<void>;
  clear(): Promise<void>;
}

const newestFirst = <T extends { measured_at: string }>(rows: T[]) =>
  [...rows].sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at));

export function createMemoryBodyRepo(): BodyRepo {
  let weights: BodyWeight[] = [];
  let measurements: BodyMeasurement[] = [];
  return {
    async weights() {
      return newestFirst(weights);
    },
    async putWeight(row) {
      weights = [...weights.filter((w) => w.id !== row.id), row];
    },
    async removeWeight(id) {
      weights = weights.filter((w) => w.id !== id);
    },
    async measurements() {
      return newestFirst(measurements);
    },
    async putMeasurement(row) {
      measurements = [...measurements.filter((m) => m.id !== row.id), row];
    },
    async removeMeasurement(id) {
      measurements = measurements.filter((m) => m.id !== id);
    },
    async clear() {
      weights = [];
      measurements = [];
    },
  };
}
