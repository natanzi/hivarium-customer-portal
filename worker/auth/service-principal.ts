/**
 * Inbound Operator Console service authentication.
 *
 * Separate from Cloudflare Access session JWTs and machine-client credentials.
 * The caller is accepted only after a timing-safe match against
 * OPERATOR_CALLER_TOKEN. Caller-controlled headers such as X-Service-Name are
 * never trusted. The bearer token is never logged, returned, or persisted.
 */

import { sha256Hex } from '../util';

export const OPERATOR_SERVICE_NAME = 'operator-console' as const;

export interface OperatorServicePrincipal {
  principalType: 'service';
  serviceName: typeof OPERATOR_SERVICE_NAME;
}

export type ServiceAuthFailure =
  | { kind: 'missing_config' }
  | { kind: 'no_token' }
  | { kind: 'invalid_token' };

/**
 * Constant-time comparison of two secret strings via SHA-256 digests.
 * Length of the raw secrets is not used as a short-circuit on the compare loop.
 */
export async function secretsEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function bearerTokenFromAuthorization(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) return null;
  return match[1];
}

export async function resolveOperatorServicePrincipal(
  request: Request,
  configuredToken: string | undefined,
): Promise<{ ok: true; principal: OperatorServicePrincipal } | { ok: false; failure: ServiceAuthFailure }> {
  if (!configuredToken) {
    return { ok: false, failure: { kind: 'missing_config' } };
  }

  const presented = bearerTokenFromAuthorization(request.headers.get('Authorization'));
  if (!presented) {
    return { ok: false, failure: { kind: 'no_token' } };
  }

  if (!(await secretsEqual(presented, configuredToken))) {
    return { ok: false, failure: { kind: 'invalid_token' } };
  }

  return {
    ok: true,
    principal: { principalType: 'service', serviceName: OPERATOR_SERVICE_NAME },
  };
}
