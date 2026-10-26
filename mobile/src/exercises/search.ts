import type { Exercise } from '@/api/types';

/**
 * Offline exercise search over the device's copy of the library.
 *
 * Query normalization mirrors the server (backend/app/services/exercise_search.py); a test
 * keeps the alias tables identical. Postgres does fuzzy trigram matching; offline we accept a
 * token as a subsequence of a word ("bnch" in "bench"), which catches most dropped letters.
 */

export const MAX_QUERY_LENGTH = 80;

export const ALIASES: Readonly<Record<string, string>> = {
  bb: 'barbell',
  db: 'dumbbell',
  kb: 'kettlebell',
  ez: 'ez bar',
  rdl: 'romanian deadlift',
  sldl: 'stiff-leg deadlift',
  ohp: 'overhead press',
  pushup: 'push-up',
  pushups: 'push-up',
  pullup: 'pull-up',
  pullups: 'pull-up',
  chinup: 'chin-up',
  chinups: 'chin-up',
  situp: 'sit-up',
  situps: 'sit-up',
};

export interface SearchQuery {
  text: string;
  tokens: string[];
}

export function normalizeQuery(raw: string): SearchQuery | null {
  const words = raw
    .trim()
    .toLowerCase()
    .slice(0, MAX_QUERY_LENGTH)
    .split(/[\s,;/]+/)
    .filter(Boolean);
  const expanded = words.map((word) => ALIASES[word] ?? word).join(' ');
  const tokens = [...new Set(expanded.split(' ').filter(Boolean))];
  if (tokens.length === 0) return null;
  return { text: expanded.split(' ').filter(Boolean).join(' '), tokens };
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) if (ch === needle[i]) i += 1;
  return i === needle.length;
}

/** 3 = name starts with the query, 2 = contains every word, 1 = typo-tolerant, 0 = no match. */
export function matchScore(name: string, query: SearchQuery): number {
  const lower = name.toLowerCase();
  if (lower.startsWith(query.text)) return 3;
  if (query.tokens.every((t) => lower.includes(t))) return 2;
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const loose = query.tokens.every(
    (t) => lower.includes(t) || (t.length >= 3 && words.some((w) => isSubsequence(t, w))),
  );
  return loose ? 1 : 0;
}

export interface LibraryFilters {
  query: string;
  /** Primary muscle slugs; any of them. */
  muscles: readonly string[];
  equipment: readonly string[];
}

const byName = (a: Exercise, b: Exercise) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Visible exercises matching the filters: best match first, then alphabetical. */
export function searchExercises(
  exercises: readonly Exercise[],
  filters: LibraryFilters,
): Exercise[] {
  const visible = exercises.filter(
    (e) =>
      !e.is_archived &&
      (filters.muscles.length === 0 || filters.muscles.includes(e.primary_muscle)) &&
      (filters.equipment.length === 0 || filters.equipment.includes(e.equipment)),
  );
  const query = normalizeQuery(filters.query);
  if (!query) return visible.sort(byName);
  return visible
    .map((exercise) => ({ exercise, score: matchScore(exercise.name, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || byName(a.exercise, b.exercise))
    .map((r) => r.exercise);
}
