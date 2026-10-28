import { ApiError } from '@/api/client';
import type { SyncChange, SyncEntity, SyncPull, SyncResult } from '@/api/types';

import { outboxKey, type CursorStore, type OutboxItem, type OutboxRepo } from './outbox';

export const PUSH_BATCH = 50;
export const PULL_LIMIT = 200;
const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;

/**
 * How long to wait before sending again after `attempts` failures: 5 s, 10 s, 20 s … up to
 * 5 min, each randomly cut to 50–100% so many phones coming back online don't all retry
 * in the same second.
 */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, attempts - 1));
  return Math.round(ceiling * (0.5 + random() / 2));
}

export interface SyncApi {
  push(changes: SyncChange[]): Promise<SyncResult[]>;
  pull(since: number, limit: number): Promise<SyncPull>;
}

/** Writes the server's copy of a row to the device; `data: null` removes it. */
export interface LocalStore {
  apply(entity: SyncEntity, id: string, data: unknown): Promise<void>;
}

/** A change the server refused; the user should hear about it. */
export interface SyncNotice {
  entity: SyncEntity;
  id: string;
  code: string;
  message: string;
}

/** synced: pushed and pulled · offline: no network · signedOut: the session ended. */
export type SyncOutcome = 'synced' | 'offline' | 'failed' | 'signedOut' | 'cancelled';

export interface SyncOptions {
  /** Send queued changes now, even ones still waiting out a backoff (back online). */
  force?: boolean;
}

interface Deps {
  outbox: OutboxRepo;
  api: SyncApi;
  local: LocalStore;
  cursor: CursorStore;
  now?: () => number;
  random?: () => number;
}

class Cancelled extends Error {}

function toChange(item: OutboxItem): SyncChange {
  return {
    entity: item.entity,
    id: item.entityId,
    op: item.op,
    base_version: item.baseVersion,
    updated_at: new Date(item.updatedAt).toISOString(),
    data: item.data,
  };
}

function versionOf(data: unknown): number | null {
  const version = (data as { version?: unknown } | null)?.version;
  return typeof version === 'number' ? version : null;
}

/**
 * A finished workout is never dropped from the device because the server refused it: the
 * user's training log matters more than a clean queue. Only a deletion elsewhere removes it.
 */
function keepsLocalCopy(item: OutboxItem, result: SyncResult): boolean {
  return (
    item.entity === 'workout' &&
    result.status === 'rejected' &&
    result.data === null &&
    result.error?.code !== 'workout_deleted'
  );
}

function outcomeOf(error: unknown): SyncOutcome {
  if (error instanceof Cancelled) return 'cancelled';
  if (error instanceof ApiError && error.code === 'network_error') return 'offline';
  if (error instanceof ApiError && error.status === 401) return 'signedOut';
  return 'failed';
}

/**
 * Push the outbox, then pull what changed on the server (CLAUDE.md §3, decision 2).
 *
 * - **Push** sends queued changes in order, in batches. Each answer settles its item, and the
 *   server's copy replaces the local one, unless the row was edited again while the push was
 *   in flight: then the newer local state stays queued, rebased on the server's new version.
 * - **Pull** applies every change after the stored cursor, except rows with queued edits
 *   (those are sent next, and their answer brings the server's copy).
 * - A failed push waits with exponential backoff. Runs are single-flight; a request during a
 *   run schedules one more run, so a change made mid-sync is sent promptly.
 */
export class SyncEngine {
  private running: Promise<SyncOutcome> | null = null;
  private again: SyncOptions | null = null;
  private epoch = 0;
  private readonly changedListeners = new Set<(entities: Set<SyncEntity>) => void>();
  private readonly noticeListeners = new Set<(notices: SyncNotice[]) => void>();
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
  }

  sync(options: SyncOptions = {}): Promise<SyncOutcome> {
    if (this.running) {
      this.again = { force: Boolean(this.again?.force || options.force) };
      return this.running;
    }
    this.running = this.loop(options).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Stop applying results of a run in flight (sign-out: the next account starts clean). */
  cancel(): void {
    this.epoch += 1;
    this.again = null;
  }

  /** Called with the entities whose local rows changed after each run. */
  onChanged(listener: (entities: Set<SyncEntity>) => void): () => void {
    this.changedListeners.add(listener);
    return () => this.changedListeners.delete(listener);
  }

  onNotice(listener: (notices: SyncNotice[]) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  private async loop(options: SyncOptions): Promise<SyncOutcome> {
    let next: SyncOptions | null = options;
    let outcome: SyncOutcome = 'synced';
    while (next) {
      this.again = null;
      outcome = await this.once(next);
      next = outcome === 'synced' ? this.again : null;
    }
    return outcome;
  }

  private async once(options: SyncOptions): Promise<SyncOutcome> {
    const epoch = this.epoch;
    const changed = new Set<SyncEntity>();
    const notices: SyncNotice[] = [];
    const apply = async (entity: SyncEntity, id: string, data: unknown) => {
      if (epoch !== this.epoch) throw new Cancelled();
      await this.deps.local.apply(entity, id, data);
      changed.add(entity);
    };
    try {
      await this.push(Boolean(options.force), apply, notices, epoch);
      await this.pull(apply, epoch);
      return 'synced';
    } catch (error) {
      return outcomeOf(error);
    } finally {
      if (changed.size > 0) this.changedListeners.forEach((listener) => listener(changed));
      if (notices.length > 0) this.noticeListeners.forEach((listener) => listener(notices));
    }
  }

  private async push(
    force: boolean,
    apply: (entity: SyncEntity, id: string, data: unknown) => Promise<void>,
    notices: SyncNotice[],
    epoch: number,
  ): Promise<void> {
    const { outbox, api } = this.deps;
    for (;;) {
      const now = this.now();
      const items = await outbox.due(force ? Number.POSITIVE_INFINITY : now, PUSH_BATCH);
      if (items.length === 0) return;
      let results: SyncResult[];
      try {
        results = await api.push(items.map(toChange));
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) {
          const attempts = Math.max(...items.map((item) => item.attempts)) + 1;
          await outbox.retryLater(
            items.map((item) => item.id),
            now + backoffMs(attempts, this.random),
          );
        }
        throw error;
      }
      if (epoch !== this.epoch) throw new Cancelled();
      if (results.length !== items.length)
        throw new Error(`push answered ${results.length} of ${items.length} changes`);
      let requeued = false;
      for (const [index, item] of items.entries()) {
        requeued =
          !(await this.settle(item, results[index] as SyncResult, apply, notices)) || requeued;
      }
      // Go on while the queue may hold more: a full batch, or an edit made during this push.
      if (items.length < PUSH_BATCH && !requeued) return;
    }
  }

  /** Handle one answer; false when the item stays queued (it was edited meanwhile). */
  private async settle(
    item: OutboxItem,
    result: SyncResult,
    apply: (entity: SyncEntity, id: string, data: unknown) => Promise<void>,
    notices: SyncNotice[],
  ): Promise<boolean> {
    const data = result.data ?? null;
    if (result.status === 'rejected') {
      notices.push({
        entity: item.entity,
        id: item.entityId,
        code: result.error?.code ?? 'rejected',
        message: result.error?.message ?? 'The server refused this change.',
      });
    }
    if (!(await this.deps.outbox.settle(item.id, item.revision))) {
      // Edited again during the push: keep the newer local state queued, based on the
      // version the server has now, so it doesn't conflict with its own earlier edit.
      const version = versionOf(data);
      if (version !== null) await this.deps.outbox.rebase(item.id, version);
      return false;
    }
    if (!keepsLocalCopy(item, result)) await apply(item.entity, item.entityId, data);
    return true;
  }

  private async pull(
    apply: (entity: SyncEntity, id: string, data: unknown) => Promise<void>,
    epoch: number,
  ): Promise<void> {
    const { outbox, api, cursor } = this.deps;
    let since = await cursor.get();
    for (;;) {
      const page = await api.pull(since, PULL_LIMIT);
      if (epoch !== this.epoch) throw new Cancelled();
      const pending = await outbox.pendingKeys();
      for (const change of page.changes) {
        if (pending.has(outboxKey(change.entity, change.id))) continue;
        await apply(change.entity, change.id, change.deleted ? null : change.data);
      }
      since = page.cursor;
      await cursor.set(since);
      if (!page.has_more) return;
    }
  }
}
