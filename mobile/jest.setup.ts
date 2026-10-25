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
