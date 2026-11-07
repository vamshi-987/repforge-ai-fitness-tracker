import { useAuth } from '@/stores/auth';
import { makeMe } from '@/test/helpers';

import { savePrivacy } from '../actions';

jest.mock('@/api/me', () => ({ updateMe: jest.fn() }));

const api = jest.requireMock<{ updateMe: jest.Mock }>('@/api/me');

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.setState({ status: 'signedIn', me: makeMe({ onboarding_complete: true }) });
});

describe('the private profile switch', () => {
  it('shows the new value only once the server has it', async () => {
    const me = useAuth.getState().me;
    api.updateMe.mockResolvedValue({ ...me, is_private: true });

    expect(await savePrivacy(true)).toBe(true);

    expect(api.updateMe).toHaveBeenCalledWith({ is_private: true });
    expect(useAuth.getState().me?.is_private).toBe(true);
  });

  it('leaves the profile as it was when saving fails', async () => {
    api.updateMe.mockRejectedValue(new Error('offline'));

    expect(await savePrivacy(true)).toBe(false);

    expect(useAuth.getState().me?.is_private).toBe(false);
  });
});
