import { and, asc, desc, eq, inArray, isNull, max } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  personalRecords,
  workoutExercises,
  workoutMuscleSets,
  workouts,
  workoutSets,
} from '@/db/schema';
import { newId } from '@/lib/ids';

import type { HistoryRepo, PreviousSet, SavedWorkout, WorkoutExtras } from './history';
import type { PreviousBests } from './records';
import { fromServerWorkout } from './serverWorkout';
import type { WorkoutExercise } from './types';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Insert a workout with its exercises, sets, muscle sets and records. */
function insertWorkout(
  tx: Tx,
  workout: SavedWorkout,
  extras: WorkoutExtras,
  sync: { version: number; syncedAt: number | null },
): void {
  const now = Date.now();
  tx.insert(workouts)
    .values({
      id: workout.id,
      routineId: workout.routineId,
      title: workout.title,
      notes: workout.notes,
      startedAt: workout.startedAt,
      endedAt: workout.endedAt,
      visibility: workout.visibility,
      totalVolumeKg: workout.volumeKg,
      totalSets: workout.setCount,
      createdAt: now,
      updatedAt: now,
      version: sync.version,
      syncedAt: sync.syncedAt,
    })
    .run();
  workout.exercises.forEach((exercise, position) => {
    tx.insert(workoutExercises)
      .values({
        id: exercise.id,
        workoutId: workout.id,
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        exerciseType: exercise.type,
        position,
        supersetGroup: exercise.supersetGroup,
        notes: exercise.notes,
      })
      .run();
    exercise.sets.forEach((set, setPosition) => {
      tx.insert(workoutSets)
        .values({
          id: set.id,
          workoutExerciseId: exercise.id,
          position: setPosition,
          setType: set.type,
          weightKg: set.weightKg,
          reps: set.reps,
          durationS: set.durationS,
          distanceM: set.distanceM,
          rpe: set.rpe,
          completed: set.completed,
        })
        .run();
    });
  });
  for (const [muscle, sets] of Object.entries(extras.muscleSets)) {
    tx.insert(workoutMuscleSets).values({ workoutId: workout.id, muscle, sets }).run();
  }
  for (const record of extras.records) {
    tx.insert(personalRecords)
      .values({
        id: newId(),
        exerciseId: record.exerciseId,
        recordType: record.type,
        value: record.value,
        workoutId: record.workoutId,
        workoutSetId: record.setId,
        previousValue: record.previous,
        achievedAt: record.achievedAt,
      })
      .run();
  }
}

export const sqliteHistoryRepo: HistoryRepo = {
  async previousSets(exerciseIds) {
    const result: Record<string, PreviousSet[]> = {};
    for (const exerciseId of new Set(exerciseIds)) {
      const latest = db
        .select({ id: workoutExercises.id })
        .from(workoutExercises)
        .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
        .where(and(eq(workoutExercises.exerciseId, exerciseId), isNull(workouts.deletedAt)))
        .orderBy(desc(workouts.startedAt), asc(workoutExercises.position))
        .limit(1)
        .get();
      if (!latest) continue;
      result[exerciseId] = db
        .select()
        .from(workoutSets)
        .where(and(eq(workoutSets.workoutExerciseId, latest.id), eq(workoutSets.completed, true)))
        .orderBy(asc(workoutSets.position))
        .all()
        .map((s) => ({
          type: s.setType,
          weightKg: s.weightKg,
          reps: s.reps,
          durationS: s.durationS,
          distanceM: s.distanceM,
        }));
    }
    return result;
  },

  async bestRecords(exerciseIds) {
    const bests: PreviousBests = {};
    if (exerciseIds.length === 0) return bests;
    const rows = db
      .select({
        exerciseId: personalRecords.exerciseId,
        type: personalRecords.recordType,
        value: max(personalRecords.value),
      })
      .from(personalRecords)
      .where(inArray(personalRecords.exerciseId, [...new Set(exerciseIds)]))
      .groupBy(personalRecords.exerciseId, personalRecords.recordType)
      .all();
    for (const row of rows) {
      if (row.value !== null) (bests[row.exerciseId] ??= {})[row.type] = row.value;
    }
    return bests;
  },

  async load(workoutId) {
    const workout = db.select().from(workouts).where(eq(workouts.id, workoutId)).get();
    if (!workout) return null;
    const exerciseRows = db
      .select()
      .from(workoutExercises)
      .where(eq(workoutExercises.workoutId, workoutId))
      .orderBy(asc(workoutExercises.position))
      .all();
    const exercises: WorkoutExercise[] = exerciseRows.map((e) => ({
      id: e.id,
      exerciseId: e.exerciseId,
      name: e.name,
      type: e.exerciseType,
      supersetGroup: e.supersetGroup,
      restSeconds: null,
      repRangeMin: null,
      repRangeMax: null,
      notes: e.notes,
      sets: db
        .select()
        .from(workoutSets)
        .where(eq(workoutSets.workoutExerciseId, e.id))
        .orderBy(asc(workoutSets.position))
        .all()
        .map((s) => ({
          id: s.id,
          type: s.setType,
          weightKg: s.weightKg,
          reps: s.reps,
          durationS: s.durationS,
          distanceM: s.distanceM,
          rpe: s.rpe,
          completed: s.completed,
        })),
    }));
    const muscleSets = Object.fromEntries(
      db
        .select()
        .from(workoutMuscleSets)
        .where(eq(workoutMuscleSets.workoutId, workoutId))
        .all()
        .map((row) => [row.muscle, row.sets]),
    );
    const records = db
      .select()
      .from(personalRecords)
      .where(eq(personalRecords.workoutId, workoutId))
      .all()
      .map((r) => ({
        exerciseId: r.exerciseId,
        type: r.recordType,
        value: r.value,
        workoutId: r.workoutId,
        setId: r.workoutSetId,
        previous: r.previousValue,
        achievedAt: r.achievedAt,
      }));
    return {
      id: workout.id,
      routineId: workout.routineId,
      title: workout.title,
      notes: workout.notes,
      startedAt: workout.startedAt,
      endedAt: workout.endedAt,
      visibility: workout.visibility,
      volumeKg: workout.totalVolumeKg,
      setCount: workout.totalSets,
      exercises,
      muscleSets,
      records,
    };
  },

  async save(workout, extras) {
    db.transaction((tx) => insertWorkout(tx, workout, extras, { version: 0, syncedAt: null }));
  },

  async putServerWorkout(workout) {
    const stored = fromServerWorkout(workout);
    db.transaction((tx) => {
      // Cascades to its exercises, sets, muscle sets and records.
      tx.delete(workouts).where(eq(workouts.id, workout.id)).run();
      insertWorkout(tx, stored, stored, { version: workout.version, syncedAt: Date.now() });
    });
  },

  async remove(workoutId) {
    db.delete(workouts).where(eq(workouts.id, workoutId)).run();
  },

  async unsynced() {
    const ids = db
      .select({ id: workouts.id })
      .from(workouts)
      .where(isNull(workouts.syncedAt))
      .orderBy(asc(workouts.startedAt))
      .all();
    const found = await Promise.all(ids.map(({ id }) => sqliteHistoryRepo.load(id)));
    return found.filter((w) => w !== null);
  },

  async clear() {
    db.delete(workouts).run();
  },
};
