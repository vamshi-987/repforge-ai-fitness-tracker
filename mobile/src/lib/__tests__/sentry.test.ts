describe('Sentry', () => {
  const sentry = { init: jest.fn(), wrap: jest.fn((c: unknown) => ['wrapped', c]) };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.doMock('@sentry/react-native', () => sentry);
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  });

  it('stays off without a DSN', () => {
    const { initSentry, wrapRoot } = jest.requireActual<typeof import('../sentry')>('../sentry');
    const component = () => null;

    initSentry();

    expect(sentry.init).not.toHaveBeenCalled();
    expect(wrapRoot(component)).toBe(component);
  });

  it('sends no personal details when on', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://key@sentry.example/1';
    const { initSentry } = jest.requireActual<typeof import('../sentry')>('../sentry');

    initSentry();

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@sentry.example/1',
        sendDefaultPii: false,
      }),
    );
  });
});
