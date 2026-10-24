import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Key/value store for sync cursors and other device-local bookkeeping. */
export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
