/**
 * Same-origin API client for the portal SPA.
 *
 * All requests go to the Worker's `/api/v1/*` boundary; no third-party hosts
 * are ever contacted by the browser. Errors are normalized into a typed
 * ApiError carrying the stable server error code.
 */

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'conflict'
  | 'validation_error'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'too_many_requests'
  | 'service_unavailable'
  | 'upstream_unavailable'
  | 'internal_error';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'internal_error', 'The portal could not be reached. Please try again.');
  }
  if (!response.ok) {
    let body: { error?: string; message?: string; requestId?: string } = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    throw new ApiError(
      response.status,
      (body.error as ApiErrorCode) ?? 'internal_error',
      body.message ?? 'The request failed. Please try again.',
      body.requestId,
    );
  }
  return (await response.json()) as T;
}

export function apiFetchJson<T>(path: string, body: unknown, init: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, {
    ...init,
    method: init.method ?? 'POST',
    headers: { ...(init.headers as Record<string, string> | undefined), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `ui_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}