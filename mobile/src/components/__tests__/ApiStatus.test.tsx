import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

import { ApiStatus } from '../ApiStatus';

function renderWithClient() {
  // gcTime: Infinity avoids a lingering garbage-collection timer after the test ends.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ApiStatus />
    </QueryClientProvider>,
  );
}

describe('ApiStatus', () => {
  it('shows the API version when the backend is reachable', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"status":"ok","version":"0.1.0"}'),
    });

    await renderWithClient();

    expect(await screen.findByText('API connected · v0.1.0')).toBeOnTheScreen();
  });

  it('shows unreachable when the request fails', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    await renderWithClient();

    expect(await screen.findByText('API unreachable')).toBeOnTheScreen();
  });
});
