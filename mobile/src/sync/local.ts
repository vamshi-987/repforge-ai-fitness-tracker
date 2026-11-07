import type {
  BodyMeasurement,
  BodyWeight,
  Exercise,
  Food,
  FoodLog,
  Routine,
  RoutineFolder,
  SavedMeal,
  WaterLog,
  Workout,
} from '@/api/types';
import type { BodyRepo } from '@/body/repo';
import type { LibraryRepo } from '@/exercises/repo';
import type { NutritionRepo } from '@/nutrition/repo';
import type { RoutineRepo } from '@/routines/repo';
import type { WaterRepo } from '@/water/repo';
import type { HistoryRepo } from '@/workout/history';

import type { LocalStore } from './engine';

/** Writes server copies into the device's repos; `null` removes the row. */
export function createLocalStore(repos: {
  library: LibraryRepo;
  routines: RoutineRepo;
  history: HistoryRepo;
  body: BodyRepo;
  water: WaterRepo;
  nutrition: NutritionRepo;
}): LocalStore {
  return {
    async apply(entity, id, data) {
      switch (entity) {
        case 'exercise':
          return data
            ? repos.library.putExercise(data as Exercise)
            : repos.library.removeExercise(id);
        case 'routine_folder':
          return data
            ? repos.routines.putFolders([data as RoutineFolder])
            : repos.routines.removeFolder(id);
        case 'routine':
          return data
            ? repos.routines.putRoutines([data as Routine])
            : repos.routines.removeRoutine(id);
        case 'workout':
          return data ? repos.history.putServerWorkout(data as Workout) : repos.history.remove(id);
        case 'body_weight':
          return data ? repos.body.putWeight(data as BodyWeight) : repos.body.removeWeight(id);
        case 'body_measurement':
          return data
            ? repos.body.putMeasurement(data as BodyMeasurement)
            : repos.body.removeMeasurement(id);
        case 'water_log':
          return data ? repos.water.put(data as WaterLog) : repos.water.remove(id);
        case 'food':
          return data ? repos.nutrition.putFood(data as Food) : repos.nutrition.removeFood(id);
        case 'food_log':
          return data ? repos.nutrition.putLog(data as FoodLog) : repos.nutrition.removeLog(id);
        case 'saved_meal':
          return data
            ? repos.nutrition.putSavedMeal(data as SavedMeal)
            : repos.nutrition.removeSavedMeal(id);
      }
    },
  };
}
