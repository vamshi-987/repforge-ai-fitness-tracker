import { eq } from 'drizzle-orm';

import type { Exercise } from '@/api/types';
import { db } from '@/db/client';
import { equipment, exercises, muscles, syncState } from '@/db/schema';

import type { LibraryRepo } from './repo';

// Stay well under SQLite's bound-parameter limit (15 columns per exercise row).
const CHUNK = 50;

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

type ExerciseRow = typeof exercises.$inferSelect;

function toRow(e: Exercise): ExerciseRow {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    equipment: e.equipment,
    primaryMuscle: e.primary_muscle,
    secondaryMuscles: e.secondary_muscles,
    instructions: e.instructions,
    mediaVideoUrl: e.media_video_url,
    mediaThumbUrl: e.media_thumb_url,
    mediaLicense: e.media_license,
    isCustom: e.is_custom,
    isArchived: e.is_archived,
    version: e.version,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  };
}

function fromRow(r: ExerciseRow): Exercise {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    equipment: r.equipment,
    primary_muscle: r.primaryMuscle,
    secondary_muscles: r.secondaryMuscles,
    instructions: r.instructions,
    media_video_url: r.mediaVideoUrl,
    media_thumb_url: r.mediaThumbUrl,
    media_license: r.mediaLicense,
    is_custom: r.isCustom,
    is_archived: r.isArchived,
    version: r.version,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

/**
 * The library mirror in SQLite. Drizzle's expo-sqlite driver is synchronous, so each write
 * runs inside one synchronous transaction: a replace is all-or-nothing.
 */
export const sqliteLibraryRepo: LibraryRepo = {
  async load() {
    return {
      exercises: db.select().from(exercises).all().map(fromRow),
      muscles: db
        .select()
        .from(muscles)
        .all()
        .map((m) => ({ id: m.id, slug: m.slug, name: m.name, body_map_key: m.bodyMapKey })),
      equipment: db
        .select()
        .from(equipment)
        .all()
        .map((e) => ({ id: e.id, slug: e.slug, name: e.name, increment_kg: e.incrementKg })),
    };
  },

  async replaceMuscles(rows) {
    db.transaction((tx) => {
      tx.delete(muscles).run();
      for (const part of chunks(rows)) {
        tx.insert(muscles)
          .values(part.map((m) => ({ ...m, bodyMapKey: m.body_map_key })))
          .run();
      }
    });
  },

  async replaceEquipment(rows) {
    db.transaction((tx) => {
      tx.delete(equipment).run();
      for (const part of chunks(rows)) {
        tx.insert(equipment)
          .values(part.map((e) => ({ ...e, incrementKg: e.increment_kg })))
          .run();
      }
    });
  },

  async replaceExercises(rows) {
    db.transaction((tx) => {
      tx.delete(exercises).run();
      for (const part of chunks(rows)) tx.insert(exercises).values(part.map(toRow)).run();
    });
  },

  async putExercise(row) {
    const values = toRow(row);
    db.insert(exercises)
      .values(values)
      .onConflictDoUpdate({ target: exercises.id, set: values })
      .run();
  },

  async removeExercise(id) {
    db.delete(exercises).where(eq(exercises.id, id)).run();
  },

  async removeCustomExercises() {
    db.delete(exercises).where(eq(exercises.isCustom, true)).run();
  },

  async getMeta(key) {
    return db.select().from(syncState).where(eq(syncState.key, key)).get()?.value ?? null;
  },

  async setMeta(key, value) {
    if (value === null) {
      db.delete(syncState).where(eq(syncState.key, key)).run();
      return;
    }
    const row = { key, value, updatedAt: new Date() };
    db.insert(syncState).values(row).onConflictDoUpdate({ target: syncState.key, set: row }).run();
  },
};
