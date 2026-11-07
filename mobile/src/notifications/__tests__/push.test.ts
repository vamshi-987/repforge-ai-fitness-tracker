import { forgetPushToken, rememberPushToken } from '../pushToken';
import { pushPath, registerForPush } from '../usePushNotifications';

jest.mock('@/api/social', () => ({
  registerPushToken: jest.fn(async () => undefined),
  removePushToken: jest.fn(async () => undefined),
}));
jest.mock('expo-notifications', () => ({
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[abc]' })),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../notifier', () => ({ ensurePermission: jest.fn(async () => true) }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'project' } } } },
}));

const api =
  jest.requireMock<Record<'registerPushToken' | 'removePushToken', jest.Mock>>('@/api/social');
const notifications = jest.requireMock<{ getExpoPushTokenAsync: jest.Mock }>('expo-notifications');
const notifier = jest.requireMock<{ ensurePermission: jest.Mock }>('../notifier');
const constants = jest.requireMock<{ default: { expoConfig: unknown } }>('expo-constants');
const WITH_PROJECT = constants.default.expoConfig;

beforeEach(async () => {
  await forgetPushToken();
  jest.clearAllMocks();
  constants.default.expoConfig = WITH_PROJECT;
  notifier.ensurePermission.mockResolvedValue(true);
});

describe('push registration', () => {
  it('sends this phone’s token to the server, and takes it back on sign-out', async () => {
    expect(await registerForPush()).toBe(true);

    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'project' });
    expect(api.registerPushToken).toHaveBeenCalledWith('ExponentPushToken[abc]', 'ios');

    await forgetPushToken();
    expect(api.removePushToken).toHaveBeenCalledWith('ExponentPushToken[abc]');
  });

  it('does nothing without an EAS project, as in Expo Go', async () => {
    constants.default.expoConfig = {};

    expect(await registerForPush()).toBe(false);
    expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('respects a refused permission', async () => {
    notifier.ensurePermission.mockResolvedValue(false);

    expect(await registerForPush()).toBe(false);
    expect(api.registerPushToken).not.toHaveBeenCalled();
  });

  it('survives any failure', async () => {
    notifications.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('no'));

    expect(await registerForPush()).toBe(false);
  });

  it('never blocks signing out', async () => {
    api.removePushToken.mockRejectedValueOnce(new Error('offline'));
    rememberPushToken('token');

    await expect(forgetPushToken()).resolves.toBeUndefined();
    api.removePushToken.mockClear();
    await forgetPushToken();
    expect(api.removePushToken).not.toHaveBeenCalled();
  });
});

describe('opening a push', () => {
  it('accepts only the app’s own destinations', () => {
    expect(pushPath({ path: '/social/workout/1' })).toBe('/social/workout/1');
    expect(pushPath({ path: '/coach/weekly' })).toBe('/coach/weekly');
    expect(pushPath({ path: '/settings' })).toBeNull();
    expect(pushPath({ path: 'https://example.com' })).toBeNull();
    expect(pushPath({ path: 3 })).toBeNull();
    expect(pushPath(null)).toBeNull();
    expect(pushPath(undefined)).toBeNull();
  });
});
