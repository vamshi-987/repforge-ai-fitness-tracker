import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { session } from '@/auth/session';
import { resetAuthStoreForTests, useAuth } from '@/stores/auth';
import {
  errorResponse,
  fetchCalls,
  jsonResponse,
  makeMe,
  mockStores,
  tokenPair,
} from '@/test/helpers';

import { AuthForm } from '../AuthForm';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: ReactNode }) => children,
}));

beforeEach(async () => {
  await session.clear();
  mockStores().secure.clear();
  mockStores().kv.clear();
  resetAuthStoreForTests();
});

async function fill(email: string, password: string) {
  await fireEvent.changeText(screen.getByTestId('email'), email);
  await fireEvent.changeText(screen.getByTestId('password'), password);
  await fireEvent.press(screen.getByTestId('submit'));
}

describe('AuthForm', () => {
  it('validates locally before calling the API', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock;
    await render(<AuthForm mode="register" />);

    await fill('lifter@example.com', 'short');

    expect(await screen.findByText('Use at least 8 characters.')).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('registers and signs in', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(201, { ...tokenPair('a'), user: makeMe(), is_new_user: true }),
      )
      .mockResolvedValueOnce(jsonResponse(200, makeMe()));
    globalThis.fetch = fetchMock;
    await render(<AuthForm mode="register" />);

    await fill('  Lifter@Example.com ', 'long-enough-password');

    await waitFor(() => expect(useAuth.getState().status).toBe('signedIn'));
    const [registerCall, meCall] = fetchCalls(fetchMock);
    expect(registerCall?.url).toBe('http://api.test/v1/auth/register');
    expect(JSON.parse(registerCall?.init.body as string)).toEqual({
      email: 'Lifter@Example.com',
      password: 'long-enough-password',
    });
    expect(meCall?.url).toBe('http://api.test/v1/me');
  });

  it('shows the server error for a failed login', async () => {
    globalThis.fetch = jest.fn().mockResolvedValueOnce(errorResponse(401, 'invalid_credentials'));
    await render(<AuthForm mode="login" />);

    await fill('lifter@example.com', 'wrong-password');

    expect(await screen.findByText('Email or password is incorrect.')).toBeOnTheScreen();
    expect(useAuth.getState().status).not.toBe('signedIn');
  });
});
