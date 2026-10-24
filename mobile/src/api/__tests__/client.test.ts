import { ApiError, apiRequest } from '../client';

function mockFetchOnce(status: number, body: unknown, raw = false) {
  const text = raw ? String(body) : body === null ? '' : JSON.stringify(body);
  const response = {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  } as Response;
  const fetchMock = jest.fn().mockResolvedValueOnce(response);
  globalThis.fetch = fetchMock;
  return fetchMock;
}

describe('apiRequest', () => {
  it('returns parsed JSON on success and hits the /v1 base URL', async () => {
    const fetchMock = mockFetchOnce(200, { status: 'ok', version: '0.1.0' });

    await expect(apiRequest('/health')).resolves.toEqual({ status: 'ok', version: '0.1.0' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/v1/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends JSON bodies and bearer tokens', async () => {
    const fetchMock = mockFetchOnce(201, { id: 'w1' });

    await apiRequest('/workouts/w1', { method: 'PUT', body: { title: 'Push' }, token: 'abc' });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe('{"title":"Push"}');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer abc',
    });
  });

  it('returns null for empty success bodies', async () => {
    mockFetchOnce(204, null);

    await expect(apiRequest('/workouts/w1', { method: 'DELETE' })).resolves.toBeNull();
  });

  it('maps the error envelope to ApiError', async () => {
    mockFetchOnce(403, {
      error: {
        code: 'routine_limit',
        message: 'Free plan allows 4 routines',
        details: { limit: 4 },
      },
    });

    const error = await apiRequest('/routines').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 403,
      code: 'routine_limit',
      message: 'Free plan allows 4 routines',
      details: { limit: 4 },
    });
  });

  it('falls back to http_error when the body is not an envelope', async () => {
    mockFetchOnce(502, '<html>Bad gateway</html>', true);

    await expect(apiRequest('/health')).rejects.toMatchObject({ status: 502, code: 'http_error' });
  });

  it('maps fetch failures to network_error', async () => {
    globalThis.fetch = jest.fn().mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(apiRequest('/health')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
      message: 'Network request failed',
    });
  });
});
