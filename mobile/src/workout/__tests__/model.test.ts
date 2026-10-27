import { makeRoutine, makeRoutineExercise } from '@/test/routines';
import { makeSet, makeWorkout, makeWorkoutExercise, sequentialIds } from '@/test/workouts';

import {
  addExercises,
  addSet,
  defaultTitle,
  findSet,
  isLoggable,
  moveExercise,
  nextSet,
  removeExercise,
  removeSet,
  rename,
  setExerciseNotes,
  setWorkoutNotes,
  startEmpty,
  startFromRoutine,
  toggleSupersetWithNext,
  updateSet,
  workoutStats,
} from '../model';

const NOW = Date.UTC(2026, 9, 27, 18, 30);

describe('starting', () => {
  it.each([
    [4, 'Evening workout'],
    [5, 'Morning workout'],
    [11, 'Morning workout'],
    [12, 'Afternoon workout'],
    [17, 'Afternoon workout'],
    [18, 'Evening workout'],
  ])('names a workout started at %p:00 “%s”', (hour, title) => {
    expect(defaultTitle(new Date(2026, 9, 27, hour, 15))).toBe(title);
  });

  it('starts empty at the given time', () => {
    const workout = startEmpty('w-1', NOW);

    expect(workout).toMatchObject({ id: 'w-1', routineId: null, startedAt: NOW, exercises: [] });
    expect(workout.title).toBe(defaultTitle(new Date(NOW)));
  });

  it('starts from a routine with its targets as values, nothing ticked', () => {
    const routine = makeRoutine({
      name: 'Push',
      exercises: [
        makeRoutineExercise({ superset_group: 3, rest_seconds: 120 }),
        makeRoutineExercise({
          exercise_id: 'pushup',
          exercise_name: 'Push-Up',
          exercise_type: 'bodyweight_reps',
          superset_group: 3,
          sets: [
            {
              set_type: 'normal',
              target_weight_kg: null,
              target_reps: 15,
              target_duration_s: null,
            },
          ],
        }),
      ],
    });

    const workout = startFromRoutine(routine, sequentialIds(), NOW);

    expect(workout).toMatchObject({
      id: 'id-1',
      routineId: routine.id,
      title: 'Push',
      startedAt: NOW,
    });
    const [bench, pushup] = workout.exercises;
    expect(bench).toMatchObject({
      id: 'id-2',
      supersetGroup: 1,
      restSeconds: 120,
      repRangeMin: 8,
      repRangeMax: 12,
    });
    expect(bench?.sets.map((s) => [s.type, s.weightKg, s.reps, s.completed])).toEqual([
      ['warmup', 40, 10, false],
      ['normal', 60, 8, false],
      ['normal', 60, 8, false],
    ]);
    expect(pushup?.supersetGroup).toBe(1);
    expect(pushup?.sets[0]).toMatchObject({ weightKg: null, reps: 15, rpe: null });
    const ids = workout.exercises.flatMap((e) => [e.id, ...e.sets.map((s) => s.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('exercises', () => {
  it('adds picked exercises with one empty set', () => {
    const workout = addExercises(
      startEmpty('w', NOW),
      [{ id: 'bench', name: 'Bench', type: 'weight_reps' }],
      sequentialIds(),
    );

    expect(workout.exercises).toHaveLength(1);
    expect(workout.exercises[0]).toMatchObject({ id: 'id-1', exerciseId: 'bench', notes: '' });
    expect(workout.exercises[0]?.sets).toEqual([
      expect.objectContaining({ id: 'id-2', weightKg: null, reps: null, completed: false }),
    ]);
  });

  it('removes, moves and supersets exercises', () => {
    const a = makeWorkoutExercise({ name: 'A' });
    const b = makeWorkoutExercise({ name: 'B' });
    const c = makeWorkoutExercise({ name: 'C' });
    let workout = makeWorkout({ exercises: [a, b, c] });
    const names = () => workout.exercises.map((e) => e.name).join('');

    workout = toggleSupersetWithNext(workout, a.id);
    expect(workout.exercises.map((e) => e.supersetGroup)).toEqual([1, 1, null]);

    workout = moveExercise(workout, c.id, -1);
    expect(names()).toBe('CAB');

    expect(moveExercise(workout, c.id, -1)).toBe(workout);
    expect(toggleSupersetWithNext(workout, b.id)).toBe(workout);

    workout = removeExercise(workout, a.id);
    expect(names()).toBe('CB');
    expect(workout.exercises.map((e) => e.supersetGroup)).toEqual([null, null]);
  });

  it('keeps notes per exercise and for the workout', () => {
    const exercise = makeWorkoutExercise();
    let workout = makeWorkout({ exercises: [exercise] });

    workout = setExerciseNotes(workout, exercise.id, 'Seat on 4');
    workout = setWorkoutNotes(rename(workout, 'Heavy push'), 'Felt strong');

    expect(workout).toMatchObject({ title: 'Heavy push', notes: 'Felt strong' });
    expect(workout.exercises[0]?.notes).toBe('Seat on 4');
  });
});

describe('sets', () => {
  it('a new set copies the last one, unticked and unrated, as a normal set', () => {
    const exercise = makeWorkoutExercise({
      sets: [makeSet({ type: 'warmup', weightKg: 40, reps: 12, rpe: 7, completed: true })],
    });

    const workout = addSet(makeWorkout({ exercises: [exercise] }), exercise.id, 'new');

    expect(workout.exercises[0]?.sets[1]).toEqual({
      id: 'new',
      type: 'normal',
      weightKg: 40,
      reps: 12,
      durationS: null,
      distanceM: null,
      rpe: null,
      completed: false,
    });
  });

  it('adds an empty set to an exercise without sets, up to 30', () => {
    const exercise = makeWorkoutExercise({ sets: [] });
    let workout = makeWorkout({ exercises: [exercise] });

    workout = addSet(workout, exercise.id, 'first');
    expect(workout.exercises[0]?.sets[0]).toMatchObject({
      id: 'first',
      weightKg: null,
      reps: null,
    });

    for (let i = 0; i < 40; i += 1) workout = addSet(workout, exercise.id, `s${i}`);
    expect(workout.exercises[0]?.sets).toHaveLength(30);
  });

  it('updates, finds and removes a set', () => {
    const exercise = makeWorkoutExercise();
    const [first, second] = exercise.sets as [
      ReturnType<typeof makeSet>,
      ReturnType<typeof makeSet>,
    ];
    let workout = makeWorkout({ exercises: [exercise] });

    workout = updateSet(workout, exercise.id, second.id, {
      weightKg: 62.5,
      completed: true,
      rpe: 8.5,
    });
    expect(findSet(workout, exercise.id, second.id)).toMatchObject({
      index: 1,
      set: { weightKg: 62.5, completed: true, rpe: 8.5 },
    });

    workout = removeSet(workout, exercise.id, first.id);
    expect(workout.exercises[0]?.sets.map((s) => s.id)).toEqual([second.id]);
    expect(findSet(workout, exercise.id, first.id)).toBeNull();
    expect(findSet(workout, 'nope', second.id)).toBeNull();
  });
});

describe('derived values', () => {
  it('counts volume only for ticked sets with a load', () => {
    const workout = makeWorkout({
      exercises: [
        makeWorkoutExercise({
          sets: [
            makeSet({ weightKg: 100, reps: 5, completed: true }),
            makeSet({ weightKg: 100, reps: 5, completed: false }),
          ],
        }),
        makeWorkoutExercise({
          type: 'weighted_bodyweight',
          sets: [makeSet({ weightKg: 20, reps: 8, completed: true })],
        }),
        makeWorkoutExercise({
          type: 'assisted_bodyweight',
          sets: [makeSet({ weightKg: 30, reps: 8, completed: true })],
        }),
        makeWorkoutExercise({
          type: 'bodyweight_reps',
          sets: [makeSet({ weightKg: null, reps: 20, completed: true })],
        }),
      ],
    });

    expect(workoutStats(workout)).toEqual({ volumeKg: 660, completedSets: 4, totalSets: 5 });
  });

  it('finds the next set to do', () => {
    const done = makeWorkoutExercise({ sets: [makeSet({ completed: true })] });
    const next = makeWorkoutExercise({
      name: 'Row',
      sets: [makeSet({ type: 'warmup', completed: true }), makeSet(), makeSet()],
    });

    const found = nextSet(makeWorkout({ exercises: [done, next] }));

    expect(found?.exercise.name).toBe('Row');
    expect(found?.label).toBe('1');
    expect(found?.set.id).toBe(next.sets[1]?.id);
    expect(nextSet(makeWorkout({ exercises: [done] }))).toBeNull();
  });

  it.each([
    ['weight_reps', { reps: null }, false],
    ['weight_reps', { weightKg: null, reps: 8 }, true],
    ['duration', { reps: null, durationS: null }, false],
    ['duration', { reps: null, durationS: 60 }, true],
    ['distance_duration', { durationS: 600, distanceM: null }, false],
    ['distance_duration', { durationS: 600, distanceM: 2000 }, true],
  ] as const)('a %s set with %p is loggable: %p', (type, patch, expected) => {
    expect(isLoggable(type, makeSet(patch))).toBe(expected);
  });
});
