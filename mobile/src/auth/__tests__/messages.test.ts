import { ApiError } from '@/api/client';

import { authErrorMessage, credentialsProblem } from '../messages';

describe('credentialsProblem', () => {
  it.each([
    ['not-an-email', 'longenough', 'login', 'Enter a valid email address.'],
    ['a@b.co', '', 'login', 'Enter your password.'],
    ['a@b.co', 'short', 'login', null],
    ['a@b.co', 'short', 'register', 'Use at least 8 characters.'],
    ['a@b.co', 'x'.repeat(129), 'register', 'Use at most 128 characters.'],
    ['  a@b.co  ', 'longenough', 'register', null],
  ] as const)('%p / %p (%s) → %p', (email, password, mode, expected) => {
    expect(credentialsProblem(email, password, mode)).toBe(expected);
  });
});

describe('authErrorMessage', () => {
  it.each([
    [new ApiError(401, 'invalid_credentials', 'x'), 'Email or password is incorrect.'],
    [
      new ApiError(409, 'email_taken', 'x'),
      'An account with this email already exists. Log in instead.',
    ],
    [new ApiError(409, 'username_taken', 'x'), 'That username is taken.'],
    [
      new ApiError(429, 'rate_limited', 'x', { retry_after_s: 61 }),
      'Too many attempts. Try again in 2 min.',
    ],
    [new ApiError(429, 'rate_limited', 'x'), 'Too many attempts. Try again later.'],
    [
      new ApiError(0, 'network_error', 'x'),
      "Can't reach RepForge. Check your connection and try again.",
    ],
    [
      new ApiError(422, 'validation_error', 'x'),
      'Some details look wrong. Check them and try again.',
    ],
    [new ApiError(503, 'provider_unavailable', 'x'), 'RepForge is having trouble. Try again soon.'],
    [new ApiError(400, 'something_new', 'Server says why'), 'Server says why'],
    [new Error('boom'), 'Something went wrong. Try again.'],
  ])('%p', (error, expected) => {
    expect(authErrorMessage(error)).toBe(expected);
  });
});
