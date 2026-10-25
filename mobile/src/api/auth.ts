import { apiRequest } from './client';
import type { AuthResponse } from './types';

export interface RegisterBody {
  email: string;
  password: string;
  username?: string;
  display_name?: string;
}

export interface LoginBody {
  email: string;
  password: string;
}

export function register(body: RegisterBody): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/register', { method: 'POST', body });
}

export function login(body: LoginBody): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/login', { method: 'POST', body });
}

/** Revokes this device's refresh-token family on the server. */
export async function logout(refreshToken: string): Promise<void> {
  await apiRequest<null>('/auth/logout', {
    method: 'POST',
    body: { refresh_token: refreshToken },
  });
}
