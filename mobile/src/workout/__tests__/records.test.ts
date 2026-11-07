import { makeSet, makeWorkoutExercise } from '@/test/workouts';

import { detectRecords, exerciseBests, muscleSets, personalRecords } from '../records';

describe('exerciseBests', () => {
  it('tracks weight, e1RM and volume for loaded lifts, ignoring warm-ups and unticked sets', () => {
    const top = makeSet({ weightKg: 100, reps: 5, completed: true });
    const volume = makeSet({ weightKg: 90, reps: 8, completed: true });
    const bests = exerciseBests('weight_reps', [
      makeSet({ type: 'warmup', weightKg: 140, reps: 1, completed: true }),
      top,
      volume,
      makeSet({ weightKg: 120, reps: 5, completed: false }),
    ]);

    expect(bests).toEqual({
      heaviest: { value: 100, setId: top.id },
      e1rm: { value: 116.67, setId: top.id },
      best_set_volume: { value: 720, setId: volume.id },
      session_volume: { value: 1220, setId: null },
    });
  });

  it('tracks added weight but no e1RM for weighted bodyweight', () => {
    const set = makeSet({ weightKg: 20, reps: 8, completed: true });

    expect(Object.keys(exerciseBests('weighted_bodyweight', [set])).sort()).toEqual([
      'best_set_volume',
      'heaviest',
      'most_reps',
      'session_volume',
    ]);
  });

  it('tracks only reps for bodyweight and assisted exercises', () => {
    const sets = [
      makeSet({ weightKg: null, reps: 12, completed: true }),
      makeSet({ reps: 15, completed: true }),
    ];

    expect(exerciseBests('bodyweight_reps', sets)).toEqual({
      most_reps: { value: 15, setId: sets[1]?.id },
    });
    expect(Object.keys(exerciseBests('assisted_bodyweight', sets))).toEqual(['most_reps']);
  });

  it('has nothing for timed exercises or sets without reps', () => {
    expect(
      exerciseBests('duration', [makeSet({ reps: null, durationS: 60, completed: true })]),
    ).toEqual({});
    expect(exerciseBests('weight_reps', [makeSet({ reps: 0, completed: true })])).toEqual({});
  });
});

describe('detectRecords', () => {
  const bench = (weightKg: number, reps: number) =>
    makeWorkoutExercise({
      exerciseId: 'bench',
      sets: [makeSet({ weightKg, reps, completed: true })],
    });

  it('stores a first session as baselines, not PRs', () => {
    const entries = detectRecords([bench(100, 5)], {}, 'w1', 1000);

    expect(entries.map((e) => [e.type, e.value, e.previous])).toEqual([
      ['heaviest', 100, null],
      ['best_set_volume', 500, null],
      ['e1rm', 116.67, null],
      ['session_volume', 500, null],
    ]);
    expect(entries.every((e) => e.workoutId === 'w1' && e.achievedAt === 1000)).toBe(true);
    expect(personalRecords(entries, [bench(100, 5)])).toEqual([]);
  });

  it('celebrates improvements, not ties', () => {
    const previous = {
      bench: { heaviest: 100, e1rm: 116.67, best_set_volume: 500, session_volume: 500 },
    };
    const exercise = bench(100, 6);

    const entries = detectRecords([exercise], previous, 'w2', 2000);

    expect(entries.map((e) => e.type).sort()).toEqual([
      'best_set_volume',
      'e1rm',
      'session_volume',
    ]);
    expect(personalRecords(entries, [exercise])).toContainEqual({
      exerciseId: 'bench',
      exerciseName: 'Bench Press (Barbell)',
      type: 'e1rm',
      value: 120,
      previous: 116.67,
    });
  });

  it('counts an exercise done twice in one workout once per record', () => {
    const entries = detectRecords(
      [bench(100, 5), bench(90, 5)],
      { bench: { heaviest: 95 } },
      'w',
      0,
    );

    expect(entries.filter((e) => e.type === 'heaviest')).toHaveLength(1);
  });
});

describe('muscleSets', () => {
  it('counts working sets: 1 for the primary muscle, 0.5 for each secondary', () => {
    const library = [
      { id: 'bench', primary_muscle: 'chest', secondary_muscles: ['triceps', 'front_delts'] },
      { id: 'dip', primary_muscle: 'triceps', secondary_muscles: ['chest'] },
    ];
    const exercises = [
      makeWorkoutExercise({
        exerciseId: 'bench',
        sets: [
          makeSet({ type: 'warmup', completed: true }),
          makeSet({ completed: true }),
          makeSet({ completed: true }),
          makeSet({ completed: false }),
        ],
      }),
      makeWorkoutExercise({ exerciseId: 'dip', sets: [makeSet({ completed: true })] }),
      makeWorkoutExercise({ exerciseId: 'unknown', sets: [makeSet({ completed: true })] }),
      makeWorkoutExercise({ exerciseId: 'dip', sets: [makeSet({ completed: false })] }),
    ];

    expect(muscleSets(exercises, library)).toEqual({ chest: 2.5, triceps: 2, front_delts: 1 });
  });
});
