import { makeMe } from '@/test/helpers';

import { destination } from '../destination';

describe('destination', () => {
  it.each([
    ['loading', null, 'idle', 'splash'],
    ['signedOut', null, 'idle', 'login'],
    ['signedIn', null, 'loading', 'splash'],
    ['signedIn', null, 'error', 'profileUnavailable'],
  ] as const)('%s / me=%p / %s → %s', (status, me, meStatus, expected) => {
    expect(destination(status, me, meStatus)).toBe(expected);
  });

  it('sends users who have not finished onboarding to onboarding', () => {
    expect(destination('signedIn', makeMe({ onboarding_complete: false }), 'idle')).toBe(
      'onboarding',
    );
  });

  it('lets onboarded users into the app, even offline', () => {
    expect(destination('signedIn', makeMe({ onboarding_complete: true }), 'error')).toBe('app');
  });
});
