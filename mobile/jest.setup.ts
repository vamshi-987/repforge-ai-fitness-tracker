// Point the API client at a fixed origin so tests never depend on a developer's .env.local.
process.env.EXPO_PUBLIC_API_URL = 'http://api.test';

// Native storage modules are replaced by in-memory maps. `globalThis.__mockStores` lets a
// test inspect or reset them; each test file gets a fresh module registry, so fresh maps.
type Stores = { secure: Map<string, string>; kv: Map<string, string> };
const stores: Stores = { secure: new Map(), kv: new Map() };
(globalThis as unknown as { __mockStores: Stores }).__mockStores = stores;

jest.mock('expo-secure-store', () => {
  const { secure } = (globalThis as unknown as { __mockStores: Stores }).__mockStores;
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 2,
    getItemAsync: jest.fn(async (key: string) => secure.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      secure.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      secure.delete(key);
    }),
  };
});

jest.mock('expo-sqlite/kv-store', () => {
  const { kv } = (globalThis as unknown as { __mockStores: Stores }).__mockStores;
  return {
    __esModule: true,
    default: {
      getItemAsync: jest.fn(async (key: string) => kv.get(key) ?? null),
      setItemAsync: jest.fn(async (key: string, value: string) => {
        kv.set(key, value);
      }),
      removeItemAsync: jest.fn(async (key: string) => kv.delete(key)),
    },
  };
});

// expo-crypto is native; Node's Web Crypto gives real, unique UUIDs.
jest.mock('expo-crypto', () => ({
  randomUUID: () =>
    (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID(),
}));

// The sync outbox and cursor live in SQLite, which Jest can't load: every test gets in-memory
// ones (inspect them with jest.requireMock('@/sync/sqliteOutbox')).
jest.mock('@/sync/sqliteOutbox', () => {
  const { createMemoryCursor, createMemoryOutbox } =
    jest.requireActual<typeof import('@/sync/outbox')>('@/sync/outbox');
  return { sqliteOutbox: createMemoryOutbox(), sqliteCursor: createMemoryCursor() };
});

// Weigh-ins and measurements: in-memory (inspect with jest.requireMock('@/body/sqliteRepo')).
jest.mock('@/body/sqliteRepo', () => {
  const { createMemoryBodyRepo } = jest.requireActual<typeof import('@/body/repo')>('@/body/repo');
  return { sqliteBodyRepo: createMemoryBodyRepo() };
});

jest.mock('@/water/sqliteRepo', () => {
  const { createMemoryWaterRepo } =
    jest.requireActual<typeof import('@/water/repo')>('@/water/repo');
  return { sqliteWaterRepo: createMemoryWaterRepo() };
});

jest.mock('@react-native-community/netinfo', () =>
  jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

// React Native loads most components lazily, on first property access. On a cold Jest cache
// (always the case in CI) the first render in a screen test would transform them inside the
// test's timeout. Loading them here moves that one-off cost to setup, which has no timeout.
{
  const RN = jest.requireActual<typeof import('react-native')>('react-native');
  void [
    RN.ActivityIndicator,
    RN.FlatList,
    RN.KeyboardAvoidingView,
    RN.Modal,
    RN.Pressable,
    RN.RefreshControl,
    RN.ScrollView,
    RN.TextInput,
    RN.Alert,
    RN.AppState,
  ];
}
