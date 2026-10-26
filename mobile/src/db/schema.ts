import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { ExerciseType } from '@/api/types';

/** Key/value store for sync cursors, ETags and other device-local bookkeeping. */
export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// --- exercise library mirror (GET /muscles, /equipment, /exercises) -----------------------
// A copy of the server's library plus the user's custom exercises, so search and the
// exercise screens work offline. Rows are replaced wholesale when the server's ETag changes.

export const muscles = sqliteTable('muscles', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  bodyMapKey: text('body_map_key').notNull(),
});

export const equipment = sqliteTable('equipment', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  incrementKg: real('increment_kg'),
});

export const exercises = sqliteTable('exercises', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').$type<ExerciseType>().notNull(),
  equipment: text('equipment').notNull(),
  primaryMuscle: text('primary_muscle').notNull(),
  secondaryMuscles: text('secondary_muscles', { mode: 'json' }).$type<string[]>().notNull(),
  instructions: text('instructions', { mode: 'json' }).$type<string[]>().notNull(),
  mediaVideoUrl: text('media_video_url'),
  mediaThumbUrl: text('media_thumb_url'),
  mediaLicense: text('media_license'),
  isCustom: integer('is_custom', { mode: 'boolean' }).notNull(),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull(),
  version: integer('version').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
