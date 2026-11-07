import type { Equipment, Exercise, Muscle } from '@/api/types';

/** Everything the exercise screens read, loaded in one go (about 420 rows). */
export interface LocalLibrary {
  exercises: Exercise[];
  muscles: Muscle[];
  equipment: Equipment[];
}

/** The device's copy of the exercise library. SQLite in the app, in memory in tests. */
export interface LibraryRepo {
  load(): Promise<LocalLibrary>;
  replaceMuscles(rows: Muscle[]): Promise<void>;
  replaceEquipment(rows: Equipment[]): Promise<void>;
  replaceExercises(rows: Exercise[]): Promise<void>;
  putExercise(row: Exercise): Promise<void>;
  removeExercise(id: string): Promise<void>;
  /** Drops the signed-in user's own exercises, e.g. on sign-out. */
  removeCustomExercises(): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string | null): Promise<void>;
}

export function createMemoryRepo(initial: Partial<LocalLibrary> = {}): LibraryRepo {
  let exercises = [...(initial.exercises ?? [])];
  let muscles = [...(initial.muscles ?? [])];
  let equipment = [...(initial.equipment ?? [])];
  const meta = new Map<string, string>();

  return {
    async load() {
      return { exercises: [...exercises], muscles: [...muscles], equipment: [...equipment] };
    },
    async replaceMuscles(rows) {
      muscles = [...rows];
    },
    async replaceEquipment(rows) {
      equipment = [...rows];
    },
    async replaceExercises(rows) {
      exercises = [...rows];
    },
    async putExercise(row) {
      exercises = [...exercises.filter((e) => e.id !== row.id), row];
    },
    async removeExercise(id) {
      exercises = exercises.filter((e) => e.id !== id);
    },
    async removeCustomExercises() {
      exercises = exercises.filter((e) => !e.is_custom);
    },
    async getMeta(key) {
      return meta.get(key) ?? null;
    },
    async setMeta(key, value) {
      if (value === null) meta.delete(key);
      else meta.set(key, value);
    },
  };
}
