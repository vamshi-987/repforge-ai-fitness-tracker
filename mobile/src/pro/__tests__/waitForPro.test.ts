import { useAuth } from '@/stores/auth';
import { makeMe } from '@/test/helpers';

import { waitForPro } from '../waitForPro';

const ME = makeMe({ onboarding_complete: true });

describe('waiting for Pro', () => {
  it('stops as soon as the webhook has landed', async () => {
    let calls = 0;
    const refreshMe = jest.fn(async () => {
      calls += 1;
      useAuth.setState({ me: { ...ME, is_pro: calls >= 2 } });
    });
    useAuth.setState({ me: ME, refreshMe });

    expect(await waitForPro(0)).toBe(true);

    expect(refreshMe).toHaveBeenCalledTimes(2);
  });

  it('gives up after a while', async () => {
    const refreshMe = jest.fn(async () => undefined);
    useAuth.setState({ me: ME, refreshMe });

    expect(await waitForPro(0)).toBe(false);

    expect(refreshMe).toHaveBeenCalledTimes(6);
  });
});
