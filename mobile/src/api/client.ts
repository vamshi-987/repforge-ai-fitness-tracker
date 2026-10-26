import { apiBaseUrl } from './config';

/** Mirrors the backend error envelope: {"error": {"code", "message", "details"}}. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  baseUrl?: string;
}

function isErrorEnvelope(value: unknown): value is { error: ApiErrorBody } {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = (value as { error: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as ApiErrorBody).code === 'string' &&
    typeof (error as ApiErrorBody).message === 'string'
  );
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export interface ApiResponse<T> {
  status: number;
  /** null for 304 Not Modified (and empty bodies). */
  data: T | null;
  etag: string | null;
}

/**
 * Fetch wrapper for the RepForge API. Resolves with the status, the parsed JSON body (typed by
 * the caller) and the ETag; 304 Not Modified resolves with `data: null`. Rejects with ApiError
 * for HTTP errors (code from the envelope) and network failures (code "network_error",
 * status 0).
 */
export async function apiRequestFull<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, token, headers = {}, signal, baseUrl = apiBaseUrl() } = options;

  const finalHeaders: Record<string, string> = { Accept: 'application/json', ...headers };
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
  if (token) finalHeaders.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Network request failed';
    throw new ApiError(0, 'network_error', message);
  }

  // Test doubles often build a bare object without headers.
  const etag = response.headers?.get('ETag') ?? null;
  if (response.status === 304) return { status: 304, data: null, etag };

  const payload = await parseJson(response);
  if (!response.ok) {
    if (isErrorEnvelope(payload)) {
      const { code, message, details } = payload.error;
      throw new ApiError(response.status, code, message, details ?? null);
    }
    throw new ApiError(response.status, 'http_error', `Request failed with ${response.status}`);
  }
  return { status: response.status, data: payload as T | null, etag };
}

/** `apiRequestFull` for callers that only want the body. */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return (await apiRequestFull<T>(path, options)).data as T;
}
