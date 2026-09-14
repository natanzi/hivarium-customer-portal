/** Safe API error envelope. No internal stack traces or leaky messages. */

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

export function errorEnvelope(code: ApiErrorCode, message: string, requestId?: string) {
  return { error: code, message, ...(requestId ? { requestId } : {}) };
}