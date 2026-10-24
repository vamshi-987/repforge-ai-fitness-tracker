import { ApiError } from '../client';
import { createQueryClient } from '../queryClient';

type RetryFn = (failureCount: number, error: unknown) => boolean;

const retry = createQueryClient().getDefaultOptions().queries?.retry as RetryFn;

describe('query retry policy', () => {
  it('retries network errors and 5xx up to twice', () => {
    const network = new ApiError(0, 'network_error', 'offline');
    const server = new ApiError(503, 'service_unavailable', 'down');

    expect(retry(0, network)).toBe(true);
    expect(retry(1, server)).toBe(true);
    expect(retry(2, server)).toBe(false);
  });

  it('never retries 4xx', () => {
    expect(retry(0, new ApiError(404, 'not_found', 'missing'))).toBe(false);
  });
});
