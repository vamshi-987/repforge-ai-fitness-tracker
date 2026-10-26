import { EXERCISES, makeExercise } from '@/test/library';

import { ALIASES, matchScore, normalizeQuery, searchExercises } from '../search';

const names = (query: string, muscles: string[] = [], equipment: string[] = []) =>
  searchExercises(EXERCISES, { query, muscles, equipment }).map((e) => e.name);

describe('normalizeQuery', () => {
  it.each([
    ['Bench', 'bench', ['bench']],
    ['  lat   PULL ', 'lat pull', ['lat', 'pull']],
    ['db bench', 'dumbbell bench', ['dumbbell', 'bench']],
    ['RDL', 'romanian deadlift', ['romanian', 'deadlift']],
    ['curl, curl/curl', 'curl curl curl', ['curl']],
  ])('%j → %j', (raw, text, tokens) => {
    expect(normalizeQuery(raw)).toEqual({ text, tokens });
  });

  it('returns null for blank input and truncates long input', () => {
    expect(normalizeQuery('  ,; ')).toBeNull();
    expect(normalizeQuery('a'.repeat(200))?.text).toHaveLength(80);
  });

  it('uses exactly the same aliases as the server', () => {
    // The mobile project has no Node typings; Jest runs from mobile/, so read relative to it.
    const fs = jest.requireActual<{ readFileSync(path: string, encoding: 'utf8'): string }>('fs');
    const source = fs.readFileSync('../backend/app/services/exercise_search.py', 'utf8');
    const block = source.slice(
      source.indexOf('ALIASES'),
      source.indexOf('}', source.indexOf('ALIASES')),
    );
    const server = Object.fromEntries(
      [...block.matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]),
    );
    expect(Object.keys(server).length).toBeGreaterThan(5);
    expect(ALIASES).toEqual(server);
  });
});

describe('matchScore', () => {
  const q = (raw: string) => normalizeQuery(raw)!;

  it('ranks prefix over contains over typo matches', () => {
    expect(matchScore('Bench Press (Barbell)', q('bench'))).toBe(3);
    expect(matchScore('Close-Grip Bench Press (Barbell)', q('bench'))).toBe(2);
    expect(matchScore('Bench Press (Barbell)', q('bnch prss'))).toBe(1);
    expect(matchScore('Squat (Barbell)', q('bench'))).toBe(0);
  });

  it('does not fuzz very short tokens', () => {
    expect(matchScore('Bench Press (Barbell)', q('bp'))).toBe(0);
  });
});

describe('searchExercises', () => {
  it('finds bench presses, best match first, and hides archived ones', () => {
    expect(names('bench')).toEqual([
      'Bench Press (Barbell)',
      'Bench Press (Dumbbell)',
      'Close-Grip Bench Press (Barbell)',
    ]);
  });

  it('expands shorthand and tolerates dropped letters', () => {
    expect(names('db bench')).toEqual(['Bench Press (Dumbbell)']);
    expect(names('pushup')).toEqual(['Push-Up']);
    expect(names('pulldwn')).toEqual(['Lat Pulldown (Cable)']);
  });

  it('filters by primary muscle and equipment, alphabetically without a query', () => {
    expect(names('', ['chest'])).toEqual([
      'Bench Press (Barbell)',
      'Bench Press (Dumbbell)',
      'Push-Up',
    ]);
    expect(names('', ['chest', 'biceps'], ['dumbbell'])).toEqual([
      'Bench Press (Dumbbell)',
      'Bicep Curl (Dumbbell)',
    ]);
    expect(names('bench', [], ['dumbbell'])).toEqual(['Bench Press (Dumbbell)']);
  });

  it('sorts case-insensitively and does not mutate its input', () => {
    const list = [makeExercise({ name: 'b' }), makeExercise({ name: 'A' })];

    expect(
      searchExercises(list, { query: '', muscles: [], equipment: [] }).map((e) => e.name),
    ).toEqual(['A', 'b']);
    expect(list.map((e) => e.name)).toEqual(['b', 'A']);
  });
});
