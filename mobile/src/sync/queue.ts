import type { OutboxRepo, QueuedChange } from './outbox';
import { sqliteOutbox } from './sqliteOutbox';

export const outbox: OutboxRepo = sqliteOutbox;

const listeners = new Set<() => void>();

/** Record a local change for the server, and wake the sync engine. */
export async function queueChange(change: QueuedChange): Promise<void> {
  await outbox.enqueue(change, Date.now());
  listeners.forEach((listener) => listener());
}

/** The sync engine listens here, so writing code never imports the engine. */
export function onQueued(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
