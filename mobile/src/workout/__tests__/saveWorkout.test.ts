import type { OutboxItem, OutboxRepo } from '@/sync/outbox';
import { makeSet, makeWorkout, makeWorkoutExercise } from '@/test/workouts';

import { toSavedWorkout } from '../finish';
import { createMemoryHistoryRepo } from '../history';
import { deleteSavedWorkout, saveFinishedWorkout, updateSavedWorkout } from '../saveWorkout';

jest.mock('@/workout/sqliteHistory', () => ({ sqliteHistoryRepo: {} }));

const LIBRARY = [{ id: 'bench', primary_muscle: 'chest', secondary_muscles: ['triceps'] }];

function benchWorkout(id: string, weightKg: number, reps: number, startedAt: number) {
  const workout = makeWorkout({
    id,
    startedAt,
    exercises: [
      makeWorkoutExercise({
        exerciseId: 'bench',
        sets: [
          makeSet({ weightKg, reps, completed: true }),
          makeSet({ weightKg, reps: 3, completed: true }),
        ],
      }),
    ],
  });
  return toSavedWorkout(workout, {
    title: 'Push',
    notes: '',
    startedAt,
    endedAt: startedAt + 3_600_000,
    visibility: 'public',
  });
}

const outbox = jest.requireMock<{ sqliteOutbox: OutboxRepo & { items: OutboxItem[] } }>(
  '@/sync/sqliteOutbox',
).sqliteOutbox;

beforeEach(() => outbox.clear());

describe('saveFinishedWorkout', () => {
  it('queues the workout for the server', async () => {
    const repo = createMemoryHistoryRepo();
    const workout = benchWorkout('w1', 100, 5, 0);

    await saveFinishedWorkout(workout, LIBRARY, repo);
    await saveFinishedWorkout(workout, LIBRARY, repo);

    expect(outbox.items).toEqual([
      expect.objectContaining({
        entity: 'workout',
        entityId: 'w1',
        op: 'upsert',
        baseVersion: null,
        data: expect.objectContaining({ title: 'Push', ended_at: '1970-01-01T01:00:00.000Z' }),
      }),
    ]);
  });

  it('sets baselines first, then celebrates beating them', async () => {
    const repo = createMemoryHistoryRepo();

    const first = await saveFinishedWorkout(benchWorkout('w1', 100, 5, 0), LIBRARY, repo);
    const second = await saveFinishedWorkout(
      benchWorkout('w2', 102.5, 5, 86_400_000),
      LIBRARY,
      repo,
    );

    expect(first).toEqual([]);
    expect(second.map((pr) => [pr.type, pr.value, pr.previous])).toEqual([
      ['heaviest', 102.5, 100],
      ['best_set_volume', 512.5, 500],
      ['e1rm', 119.58, 116.67],
      ['session_volume', 820, 800],
    ]);
    const stored = await repo.load('w2');
    expect(stored?.muscleSets).toEqual({ chest: 2, triceps: 1 });
    expect(stored?.records).toHaveLength(4);
    expect(await repo.previousSets(['bench'])).toEqual({
      bench: [
        expect.objectContaining({ weightKg: 102.5, reps: 5 }),
        expect.objectContaining({ weightKg: 102.5, reps: 3 }),
      ],
    });
  });

  it('saving the same workout again returns the first result', async () => {
    const repo = createMemoryHistoryRepo();
    await saveFinishedWorkout(benchWorkout('w1', 100, 5, 0), LIBRARY, repo);
    const workout = benchWorkout('w2', 110, 5, 1);
    const prs = await saveFinishedWorkout(workout, LIBRARY, repo);

    const again = await saveFinishedWorkout(workout, LIBRARY, repo);

    expect(again).toEqual(prs);
    expect(repo.workouts).toHaveLength(2);
  });
});

describe('editing and deleting saved workouts', () => {
  it('recomputes the edited workout against the other workouts only', async () => {
    const repo = createMemoryHistoryRepo();
    await saveFinishedWorkout(benchWorkout('w1', 100, 5, 0), LIBRARY, repo);
    const second = benchWorkout('w2', 105, 5, 86_400_000);
    await saveFinishedWorkout(second, LIBRARY, repo);
    repo.sync.set('w2', { version: 3, syncedAt: 1 });
    await outbox.clear();

    // The weight was a typo: 95, not 105. No longer a record over w1's 100.
    const edited = benchWorkout('w2', 95, 5, 86_400_000);
    await updateSavedWorkout(edited, LIBRARY, repo);

    const stored = await repo.load('w2');
    expect(stored?.records.filter((r) => r.type === 'heaviest')).toEqual([]);
    expect(stored?.muscleSets).toEqual({ chest: 2, triceps: 1 });
    expect(repo.sync.get('w2')).toEqual({ version: 3, syncedAt: 1 });
    expect(outbox.items).toEqual([
      expect.objectContaining({ entityId: 'w2', op: 'upsert', baseVersion: 3 }),
    ]);
  });

  it('deletes from the device and queues the deletion', async () => {
    const repo = createMemoryHistoryRepo();
    await saveFinishedWorkout(benchWorkout('w1', 100, 5, 0), LIBRARY, repo);
    await outbox.clear();

    await deleteSavedWorkout('w1', repo);

    expect(await repo.load('w1')).toBeNull();
    expect(outbox.items).toEqual([
      expect.objectContaining({ entity: 'workout', entityId: 'w1', op: 'delete' }),
    ]);
  });

  it('lists summaries newest first with their record counts', async () => {
    const repo = createMemoryHistoryRepo();
    await saveFinishedWorkout(benchWorkout('w1', 100, 5, 0), LIBRARY, repo);
    await saveFinishedWorkout(benchWorkout('w2', 105, 5, 86_400_000), LIBRARY, repo);

    const list = await repo.list();

    expect(list.map((w) => [w.id, w.prCount, w.exerciseNames])).toEqual([
      ['w2', 4, ['Bench Press (Barbell)']],
      ['w1', 0, ['Bench Press (Barbell)']],
    ]);
  });
});
