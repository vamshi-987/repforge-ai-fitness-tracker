import type { Routine, RoutineFolder } from '@/api/types';

/** Everything the routine screens read: a user has a handful of routines and folders. */
export interface LocalRoutines {
  routines: Routine[];
  folders: RoutineFolder[];
  /** How many routines the account may keep; null = unlimited (Pro). */
  limit: number | null;
}

/** The device's copy of the user's routines. SQLite in the app, in memory in tests. */
export interface RoutineRepo {
  load(): Promise<LocalRoutines>;
  replaceAll(data: LocalRoutines): Promise<void>;
  putRoutines(rows: Routine[]): Promise<void>;
  removeRoutine(id: string): Promise<void>;
  putFolders(rows: RoutineFolder[]): Promise<void>;
  removeFolder(id: string): Promise<void>;
  /** Forget everything, e.g. on sign-out. */
  clear(): Promise<void>;
}

const NO_LIMIT_YET = null;

function upsert<T extends { id: string }>(list: T[], rows: T[]): T[] {
  const ids = new Set(rows.map((row) => row.id));
  return [...list.filter((item) => !ids.has(item.id)), ...rows];
}

export function createMemoryRoutineRepo(initial: Partial<LocalRoutines> = {}): RoutineRepo {
  let routines = [...(initial.routines ?? [])];
  let folders = [...(initial.folders ?? [])];
  let limit = initial.limit ?? NO_LIMIT_YET;

  return {
    async load() {
      return { routines: [...routines], folders: [...folders], limit };
    },
    async replaceAll(data) {
      routines = [...data.routines];
      folders = [...data.folders];
      limit = data.limit;
    },
    async putRoutines(rows) {
      routines = upsert(routines, rows);
    },
    async removeRoutine(id) {
      routines = routines.filter((r) => r.id !== id);
    },
    async putFolders(rows) {
      folders = upsert(folders, rows);
    },
    async removeFolder(id) {
      folders = folders.filter((f) => f.id !== id);
    },
    async clear() {
      routines = [];
      folders = [];
      limit = NO_LIMIT_YET;
    },
  };
}
