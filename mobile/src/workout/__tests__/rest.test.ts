import { makeWorkout, makeWorkoutExercise } from '@/test/workouts';

import { adjustEnd, remainingMs, remainingSeconds, restAfterSet, restSecondsFor } from '../rest';

describe('restSecondsFor', () => {
  it('uses the routine value, then the user default, then 90 s', () => {
    expect(restSecondsFor(makeWorkoutExercise({ restSeconds: 120 }), 60)).toBe(120);
    expect(restSecondsFor(makeWorkoutExercise({ restSeconds: 0 }), 60)).toBe(0);
    expect(restSecondsFor(makeWorkoutExercise(), 60)).toBe(60);
    expect(restSecondsFor(makeWorkoutExercise(), undefined)).toBe(90);
  });
});

describe('restAfterSet', () => {
  const a = makeWorkoutExercise({ supersetGroup: 1, restSeconds: 30 });
  const b = makeWorkoutExercise({ supersetGroup: 1, restSeconds: 150 });
  const c = makeWorkoutExercise({ restSeconds: 0 });
  const d = makeWorkoutExercise();
  const workout = makeWorkout({ exercises: [a, b, c, d] });

  it('waits for the end of a superset round', () => {
    expect(restAfterSet(workout, a.id, 90)).toBe(0);
    expect(restAfterSet(workout, b.id, 90)).toBe(150);
  });

  it('honours "no rest" and the default', () => {
    expect(restAfterSet(workout, c.id, 90)).toBe(0);
    expect(restAfterSet(workout, d.id, 75)).toBe(75);
    expect(restAfterSet(workout, 'gone', 90)).toBe(0);
  });
});

describe('countdown', () => {
  it('is derived from the end time', () => {
    expect(remainingMs(10_000, 4_000)).toBe(6_000);
    expect(remainingMs(10_000, 12_000)).toBe(0);
    expect(remainingSeconds(10_000, 8_001)).toBe(2);
    expect(remainingSeconds(10_000, 9_999)).toBe(1);
    expect(remainingSeconds(10_000, 10_000)).toBe(0);
  });

  it('moves the end by 15 s, and stops when nothing is left', () => {
    expect(adjustEnd(60_000, 15, 0)).toBe(75_000);
    expect(adjustEnd(60_000, -15, 0)).toBe(45_000);
    expect(adjustEnd(10_000, -15, 0)).toBeNull();
    // Already over: +15 counts from now.
    expect(adjustEnd(5_000, 15, 8_000)).toBe(23_000);
  });
});
