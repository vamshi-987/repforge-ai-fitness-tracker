import type { WaterLog } from '@/api/types';

/** The device's drinks (synced). SQLite in the app, memory in tests. */
export interface WaterRepo {
  /** Drinks with `start <= logged_at < end` (epoch ms), oldest first. */
  between(start: number, end: number): Promise<WaterLog[]>;
  put(row: WaterLog): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export function createMemoryWaterRepo(): WaterRepo & { rows: WaterLog[] } {
  const rows: WaterLog[] = [];
  return {
    rows,
    async between(start, end) {
      return rows
        .filter((r) => {
          const at = Date.parse(r.logged_at);
          return at >= start && at < end;
        })
        .sort((a, b) => Date.parse(a.logged_at) - Date.parse(b.logged_at));
    },
    async put(row) {
      const index = rows.findIndex((r) => r.id === row.id);
      if (index >= 0) rows.splice(index, 1, row);
      else rows.push(row);
    },
    async remove(id) {
      const index = rows.findIndex((r) => r.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
    async clear() {
      rows.splice(0, rows.length);
    },
  };
}
