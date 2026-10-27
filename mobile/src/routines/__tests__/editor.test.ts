import type { ExerciseType } from '@/api/types';
import { makeRoutine, makeRoutineExercise } from '@/test/routines';

import {
  addExercises,
  addSet,
  draftFromRoutine,
  emptyDraft,
  hasErrors,
  isLinkedWithNext,
  MAX_EXERCISES,
  MAX_SETS,
  moveExercise,
  removeExercise,
  removeSet,
  repairSupersets,
  toggleSupersetWithNext,
  toPayload,
  updateExercise,
  updateSet,
  validateDraft,
  type RoutineDraft,
} from '../editor';

function draftWith(names: string[], groups: (number | null)[] = []): RoutineDraft {
  const draft = addExercises(
    emptyDraft(),
    names.map((name) => ({ id: `id-${name}`, name, type: 'weight_reps' as ExerciseType })),
  );
  return {
    ...draft,
    exercises: draft.exercises.map((e, i) => ({ ...e, supersetGroup: groups[i] ?? null })),
  };
}

const order = (draft: RoutineDraft) => draft.exercises.map((e) => e.name).join('');
const groups = (draft: RoutineDraft) => draft.exercises.map((e) => e.supersetGroup);
const keyOf = (draft: RoutineDraft, name: string) =>
  draft.exercises.find((e) => e.name === name)?.key ?? '';

describe('repairSupersets', () => {
  // Same numbering as the server's normalize_supersets (backend/tests/test_routine_rules.py).
  it.each<[(number | null)[], (number | null)[]]>([
    [[], []],
    [
      [null, null],
      [null, null],
    ],
    [
      [7, 7, null, 3, 3, 3],
      [1, 1, null, 2, 2, 2],
    ],
    [
      [2, 2, 1, 1],
      [1, 1, 2, 2],
    ],
    [[5], [null]],
    [
      [1, 2, 2, 3],
      [null, 1, 1, null],
    ],
    // Where the server rejects, the editor repairs: a reappearing group starts a new one.
    [
      [1, 1, null, 1, 1],
      [1, 1, null, 2, 2],
    ],
    [
      [1, null, 1],
      [null, null, null],
    ],
  ])('%p → %p', (input, expected) => {
    expect(repairSupersets(input)).toEqual(expected);
  });
});

describe('supersets', () => {
  it('links an exercise with the next one and unlinks it again', () => {
    const draft = draftWith(['A', 'B', 'C']);

    const linked = toggleSupersetWithNext(draft, keyOf(draft, 'A'));
    expect(groups(linked)).toEqual([1, 1, null]);
    expect(isLinkedWithNext(linked, 0)).toBe(true);
    expect(isLinkedWithNext(linked, 1)).toBe(false);

    const unlinked = toggleSupersetWithNext(linked, keyOf(linked, 'A'));
    expect(groups(unlinked)).toEqual([null, null, null]);
  });

  it('grows a superset from either side', () => {
    const draft = draftWith(['A', 'B', 'C', 'D'], [null, 1, 1, null]);

    expect(groups(toggleSupersetWithNext(draft, keyOf(draft, 'A')))).toEqual([1, 1, 1, null]);
    expect(groups(toggleSupersetWithNext(draft, keyOf(draft, 'C')))).toEqual([null, 1, 1, 1]);
  });

  it('merges two neighbouring supersets', () => {
    const draft = draftWith(['A', 'B', 'C', 'D'], [1, 1, 2, 2]);

    expect(groups(toggleSupersetWithNext(draft, keyOf(draft, 'B')))).toEqual([1, 1, 1, 1]);
  });

  it('splits a superset where it is unlinked', () => {
    const draft = draftWith(['A', 'B', 'C', 'D'], [1, 1, 1, 1]);

    expect(groups(toggleSupersetWithNext(draft, keyOf(draft, 'B')))).toEqual([1, 1, 2, 2]);
    expect(groups(toggleSupersetWithNext(draft, keyOf(draft, 'A')))).toEqual([null, 1, 1, 1]);
  });

  it('does nothing for the last exercise', () => {
    const draft = draftWith(['A', 'B']);

    expect(toggleSupersetWithNext(draft, keyOf(draft, 'B'))).toBe(draft);
  });

  it('removing a member of a pair dissolves the superset', () => {
    const draft = draftWith(['A', 'B', 'C'], [1, 1, null]);

    expect(groups(removeExercise(draft, keyOf(draft, 'A')))).toEqual([null, null]);
  });
});

describe('moveExercise', () => {
  it('swaps plain neighbours', () => {
    const draft = draftWith(['A', 'B', 'C']);

    expect(order(moveExercise(draft, keyOf(draft, 'A'), 1))).toBe('BAC');
    expect(order(moveExercise(draft, keyOf(draft, 'C'), -1))).toBe('ACB');
  });

  it('ignores moves past either end', () => {
    const draft = draftWith(['A', 'B']);

    expect(moveExercise(draft, keyOf(draft, 'A'), -1)).toBe(draft);
    expect(moveExercise(draft, keyOf(draft, 'B'), 1)).toBe(draft);
  });

  it('reorders inside a superset without breaking it', () => {
    const draft = draftWith(['A', 'B', 'C'], [1, 1, null]);
    const moved = moveExercise(draft, keyOf(draft, 'A'), 1);

    expect(order(moved)).toBe('BAC');
    expect(groups(moved)).toEqual([1, 1, null]);
  });

  it('jumps over a neighbouring superset as a whole', () => {
    const draft = draftWith(['A', 'B', 'C', 'D'], [null, 1, 1, null]);

    const down = moveExercise(draft, keyOf(draft, 'A'), 1);
    const up = moveExercise(draft, keyOf(draft, 'D'), -1);

    expect(order(down)).toBe('BCAD');
    expect(groups(down)).toEqual([1, 1, null, null]);
    expect(order(up)).toBe('ADBC');
    expect(groups(up)).toEqual([null, null, 1, 1]);
  });

  it('moving out of a superset leaves it', () => {
    const draft = draftWith(['A', 'B', 'C', 'D'], [1, 1, 1, null]);
    const moved = moveExercise(draft, keyOf(draft, 'C'), 1);

    expect(order(moved)).toBe('ABDC');
    expect(groups(moved)).toEqual([1, 1, null, null]);
  });
});

describe('exercises and sets', () => {
  it('adds picked exercises with one empty set, up to the limit', () => {
    const many = Array.from({ length: MAX_EXERCISES + 5 }, (_, i) => ({
      id: `e${i}`,
      name: `E${i}`,
      type: 'weight_reps' as ExerciseType,
    }));

    const draft = addExercises(emptyDraft(), many);

    expect(draft.exercises).toHaveLength(MAX_EXERCISES);
    expect(draft.exercises[0]?.sets).toHaveLength(1);
    expect(new Set(draft.exercises.map((e) => e.key)).size).toBe(MAX_EXERCISES);
  });

  it('a new set copies the last one as a normal set', () => {
    let draft = draftWith(['A']);
    const key = keyOf(draft, 'A');
    const first = draft.exercises[0]?.sets[0]?.key ?? '';
    draft = updateSet(draft, key, first, { setType: 'warmup', weight: '40', reps: '10' });

    draft = addSet(draft, key);

    const [, second] = draft.exercises[0]?.sets ?? [];
    expect(second).toMatchObject({ setType: 'normal', weight: '40', reps: '10' });
    expect(second?.key).not.toBe(first);
  });

  it('stops adding sets at the limit and removes them', () => {
    let draft = draftWith(['A']);
    const key = keyOf(draft, 'A');
    for (let i = 0; i < MAX_SETS + 3; i += 1) draft = addSet(draft, key);
    expect(draft.exercises[0]?.sets).toHaveLength(MAX_SETS);

    const setKey = draft.exercises[0]?.sets[0]?.key ?? '';
    draft = removeSet(draft, key, setKey);
    expect(draft.exercises[0]?.sets).toHaveLength(MAX_SETS - 1);
  });
});

describe('draftFromRoutine', () => {
  it('shows targets in the user’s units', () => {
    const routine = makeRoutine({
      name: 'Push',
      exercises: [
        makeRoutineExercise({ rest_seconds: 120 }),
        makeRoutineExercise({
          exercise_id: 'plank',
          exercise_name: 'Plank',
          exercise_type: 'duration',
          rep_range_min: null,
          rep_range_max: null,
          sets: [
            {
              set_type: 'normal',
              target_weight_kg: null,
              target_reps: null,
              target_duration_s: 90,
            },
          ],
        }),
      ],
    });

    const draft = draftFromRoutine(routine, 'lb');

    const [bench, plank] = draft.exercises;
    expect(bench).toMatchObject({ restSeconds: 120, repMin: '8', repMax: '12' });
    expect(bench?.sets.map((s) => s.weight)).toEqual(['88.2', '132.3', '132.3']);
    expect(plank?.sets[0]).toMatchObject({ weight: '', reps: '', duration: '1:30' });
  });
});

describe('validateDraft', () => {
  it('needs a name', () => {
    expect(validateDraft(emptyDraft(), 'kg').name).toBe('Give the routine a name');
    expect(hasErrors(validateDraft({ ...emptyDraft(), name: 'Push' }, 'kg'))).toBe(false);
  });

  it.each([
    [{ repMin: '0' }, 'Rep range must be 1–100'],
    [{ repMax: 'abc' }, 'Rep range must be 1–100'],
    [{ repMin: '12', repMax: '8' }, 'Min reps must not be more than max reps'],
  ])('checks the rep range %p', (patch, message) => {
    let draft = { ...draftWith(['A']), name: 'Push' };
    draft = updateExercise(draft, keyOf(draft, 'A'), patch);

    expect(validateDraft(draft, 'kg').exercises[keyOf(draft, 'A')]).toBe(message);
  });

  it.each([
    [{ weight: 'heavy' }, 'Set 1: weight must be 0–1000 kg'],
    [{ weight: '1000.5' }, 'Set 1: weight must be 0–1000 kg'],
    [{ reps: '8.5' }, 'Set 1: reps must be a whole number'],
  ])('checks set %p', (patch, message) => {
    let draft = { ...draftWith(['A']), name: 'Push' };
    const key = keyOf(draft, 'A');
    draft = updateSet(draft, key, draft.exercises[0]?.sets[0]?.key ?? '', patch);

    expect(validateDraft(draft, 'kg').exercises[key]).toBe(message);
  });

  it('allows weights up to the limit in pounds', () => {
    let draft = { ...draftWith(['A']), name: 'Push' };
    const key = keyOf(draft, 'A');
    draft = updateSet(draft, key, draft.exercises[0]?.sets[0]?.key ?? '', { weight: '2200' });

    expect(validateDraft(draft, 'lb').exercises[key]).toBeUndefined();
  });

  it('checks a typed duration', () => {
    let draft = addExercises({ ...emptyDraft(), name: 'Core' }, [
      { id: 'plank', name: 'Plank', type: 'duration' },
    ]);
    const key = draft.exercises[0]?.key ?? '';
    draft = updateSet(draft, key, draft.exercises[0]?.sets[0]?.key ?? '', { duration: '1:75' });

    expect(validateDraft(draft, 'kg').exercises[key]).toBe('Set 1: time must look like 1:30');
  });
});

describe('toPayload', () => {
  it('sends kg, seconds and only the targets the type uses', () => {
    let draft: RoutineDraft = {
      ...emptyDraft('f-1'),
      name: '  Push   day ',
      notes: ' heavy ',
    };
    draft = addExercises(draft, [
      { id: 'bench', name: 'Bench', type: 'weight_reps' },
      { id: 'pullup', name: 'Pull-Up', type: 'bodyweight_reps' },
      { id: 'plank', name: 'Plank', type: 'duration' },
    ]);
    const [bench, pullup, plank] = draft.exercises.map((e) => e.key) as [string, string, string];
    const firstSet = (key: string) =>
      draft.exercises.find((e) => e.key === key)?.sets[0]?.key ?? '';
    draft = updateExercise(draft, bench, { repMin: '8', repMax: '12', restSeconds: 150 });
    draft = updateSet(draft, bench, firstSet(bench), { weight: '135', reps: '8' });
    draft = updateSet(draft, pullup, firstSet(pullup), { weight: '20', reps: '10' });
    draft = updateSet(draft, plank, firstSet(plank), { duration: '1:30', reps: '3' });
    draft = toggleSupersetWithNext(draft, bench);

    expect(toPayload(draft, 'lb')).toEqual({
      name: 'Push day',
      notes: 'heavy',
      folder_id: 'f-1',
      exercises: [
        {
          exercise_id: 'bench',
          superset_group: 1,
          rest_seconds: 150,
          rep_range_min: 8,
          rep_range_max: 12,
          notes: '',
          sets: [
            {
              set_type: 'normal',
              target_weight_kg: 61.23,
              target_reps: 8,
              target_duration_s: null,
            },
          ],
        },
        {
          exercise_id: 'pullup',
          superset_group: 1,
          rest_seconds: null,
          rep_range_min: null,
          rep_range_max: null,
          notes: '',
          sets: [
            {
              set_type: 'normal',
              target_weight_kg: null,
              target_reps: 10,
              target_duration_s: null,
            },
          ],
        },
        {
          exercise_id: 'plank',
          superset_group: null,
          rest_seconds: null,
          rep_range_min: null,
          rep_range_max: null,
          notes: '',
          sets: [
            {
              set_type: 'normal',
              target_weight_kg: null,
              target_reps: null,
              target_duration_s: 90,
            },
          ],
        },
      ],
    });
  });
});
