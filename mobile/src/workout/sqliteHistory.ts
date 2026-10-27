import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { workoutExercises, workouts, workoutSets } from '@/db/schema';

import type { HistoryRepo, PreviousSet } from './history';

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

  async save(workout) {
    const now = Date.now();
    db.transaction((tx) => {
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
    });
  },
};
