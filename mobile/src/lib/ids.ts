import { randomUUID } from 'expo-crypto';

/** A random UUID (v4). Client-generated ids make server writes idempotent (PUT by id). */
export function newId(): string {
  return randomUUID();
}
