import { Platform } from 'react-native';

/** One weigh-in from the phone's health store. */
export interface HealthWeight {
  id: string;
  measuredAt: number;
  weightKg: number;
}

export interface HealthWorkout {
  title: string;
  startedAt: number;
  endedAt: number;
}

/** The phone's health store, behind the little this app needs from it. */
export interface HealthBridge {
  /** "Apple Health" or "Health Connect". */
  name: string;
  connect(): Promise<boolean>;
  weightsSince(ms: number): Promise<HealthWeight[]>;
  saveWorkout(workout: HealthWorkout): Promise<void>;
}

async function appleHealth(): Promise<HealthBridge | null> {
  const kit = await import('@kingstinct/react-native-healthkit');
  if (!kit.isHealthDataAvailable()) return null;
  return {
    name: 'Apple Health',
    async connect() {
      return kit.requestAuthorization({
        toRead: ['HKQuantityTypeIdentifierBodyMass'],
        toShare: ['HKWorkoutTypeIdentifier'],
      });
    },
    async weightsSince(ms) {
      const samples = await kit.queryQuantitySamples('HKQuantityTypeIdentifierBodyMass', {
        limit: 0,
        unit: 'kg',
        ascending: true,
        filter: { date: { startDate: new Date(ms) } },
      });
      return samples.map((s) => ({
        id: s.uuid,
        measuredAt: s.startDate.getTime(),
        weightKg: s.quantity,
      }));
    },
    async saveWorkout({ startedAt, endedAt }) {
      await kit.saveWorkoutSample(
        kit.WorkoutActivityType.traditionalStrengthTraining,
        [],
        new Date(startedAt),
        new Date(endedAt),
      );
    },
  };
}

async function healthConnect(): Promise<HealthBridge | null> {
  const connect = await import('react-native-health-connect');
  if (!(await connect.initialize())) return null;
  return {
    name: 'Health Connect',
    async connect() {
      const granted = await connect.requestPermission([
        { accessType: 'read', recordType: 'Weight' },
        { accessType: 'write', recordType: 'ExerciseSession' },
      ]);
      return granted.length > 0;
    },
    async weightsSince(ms) {
      const { records } = await connect.readRecords('Weight', {
        timeRangeFilter: { operator: 'after', startTime: new Date(ms).toISOString() },
      });
      return records.flatMap((r) =>
        r.metadata?.id
          ? [
              {
                id: r.metadata.id,
                measuredAt: Date.parse(r.time),
                weightKg: r.weight.inKilograms,
              },
            ]
          : [],
      );
    },
    async saveWorkout({ title, startedAt, endedAt }) {
      await connect.insertRecords([
        {
          recordType: 'ExerciseSession',
          exerciseType: connect.ExerciseType.STRENGTH_TRAINING,
          title,
          startTime: new Date(startedAt).toISOString(),
          endTime: new Date(endedAt).toISOString(),
        },
      ]);
    },
  };
}

/**
 * The store on this phone, or null. Null covers Expo Go too: the native modules aren't in it,
 * and these imports throw there, so nothing may load them outside this function.
 */
export async function healthBridge(): Promise<HealthBridge | null> {
  try {
    if (Platform.OS === 'ios') return await appleHealth();
    if (Platform.OS === 'android') return await healthConnect();
  } catch {
    // Not available in this build.
  }
  return null;
}
