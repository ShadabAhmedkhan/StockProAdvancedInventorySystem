import { API_URL } from './env';
import { getAccessToken, setAccessToken } from './auth-token';

export interface ResponseMeta {
  requestId: string;
  timestamp: string;
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
}

export interface ApiResponse<T> {
  data: T;
  meta: ResponseMeta;
}

export interface ApiFieldError {
  field: string;
  constraints: string[];
}

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  errors?: ApiFieldError[];
  requestId: string;
  path: string;
  timestamp: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = 'ApiError';
  }
}

export interface AuthResult {
  accessToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    status: string;
    lastLoginAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
}

interface RequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  body?: unknown;
  headers?: Record<string, string>;
  /** Skip the automatic 401-refresh-retry, used by the refresh call itself. */
  skipAuthRetry?: boolean;
}

async function rawRequestEnvelope<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { body, skipAuthRetry: _skipAuthRetry, headers, ...rest } = options;
  const token = getAccessToken();

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token !== null ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const json: unknown = response.status === 204 ? undefined : await response.json();

  if (!response.ok) {
    throw new ApiError(response.status, json as ApiErrorBody);
  }

  return json as ApiResponse<T>;
}

async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return (await rawRequestEnvelope<T>(path, options)).data;
}

/**
 * A 401 outside of `/auth/*` means the access token has expired; the refresh
 * cookie is httpOnly so this is the only place that can silently recover it.
 * Concurrent 401s share one in-flight refresh instead of racing the endpoint.
 */
let refreshInFlight: Promise<AuthResult> | null = null;

export function refreshSession(): Promise<AuthResult> {
  refreshInFlight ??= rawRequest<AuthResult>('/auth/refresh', { method: 'POST', skipAuthRetry: true }).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function apiRequestEnvelope<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  try {
    return await rawRequestEnvelope<T>(path, options);
  } catch (error) {
    const isAuthRoute = path.startsWith('/auth/');
    if (error instanceof ApiError && error.status === 401 && options.skipAuthRetry !== true && !isAuthRoute) {
      const session = await refreshSession();
      setAccessToken(session.accessToken);
      return rawRequestEnvelope<T>(path, options);
    }
    throw error;
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return (await apiRequestEnvelope<T>(path, options)).data;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

/** For list endpoints: the API spreads pagination detail into `meta` instead of nesting it under `data`. */
async function getPaginated<T>(path: string, options?: RequestOptions): Promise<PaginatedResult<T>> {
  const { data, meta } = await apiRequestEnvelope<T[]>(path, { ...options, method: 'GET' });
  return {
    items: data,
    pagination: { page: meta.page ?? 1, limit: meta.limit ?? data.length, total: meta.total ?? data.length, totalPages: meta.totalPages ?? 1 },
  };
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) => apiRequest<T>(path, { ...options, method: 'GET' }),
  getPaginated,
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) => apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
