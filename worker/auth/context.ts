/**
 * Identity resolution for every `/api/v1/*` request.
 *
 * Two authenticated actors exist:
 *  - session: a human behind Cloudflare Access, identified by the verified
 *    `Cf-Access-Jwt-Assertion` token (or, only when ENVIRONMENT !==
 *    'production', the identically-verified PORTAL_DEV_JWT cookie);
 *  - machine: an external agent presenting a `hv_`-prefixed credential in the
 *    Authorization header, matched against api_clients by SHA-256 hash.
 *
 * The active customer id and portal role are derived exclusively here, on the
 * server, from PORTAL_DB. Client-submitted emails, customer ids and roles are
 * never trusted.
 */

import type { Capabilities, PortalRole } from '../../shared/types';
import type { MembershipRow } from '../db/repos/memberships';
import { findActiveMembershipByEmail, findMembershipAccessStateByEmail } from '../db/repos/memberships';
import type { ApiClientRow } from '../db/repos/api-clients';
import { findClientByCredential, touchClientLastUsed } from '../db/repos/api-clients';
import { capabilitiesFor } from './roles';
import { CertKeyProvider, JwtVerificationError, verifyAccessJwt, type KeyProvider } from './access-jwt';

export const DEV_JWT_COOKIE_NAME = 'PORTAL_DEV_JWT';

export type AuthFailure =
  | { kind: 'missing_config' }
  | { kind: 'no_token' }
  | { kind: 'invalid_token' }
  | { kind: 'no_membership' }
  | { kind: 'not_provisioned' }
  | { kind: 'access_disabled' }
  | { kind: 'access_expired' }
  | { kind: 'invalid_credentials' };

export interface SessionIdentity {
  kind: 'session';
  email: string;
  membership: MembershipRow;
  customerId: string;
  role: PortalRole;
  capabilities: Capabilities;
}

export interface MachineIdentity {
  kind: 'machine';
  client: ApiClientRow;
  customerId: string;
  scopes: string[];
  capabilities: Capabilities;
}

export type PortalIdentity = SessionIdentity | MachineIdentity;

export interface IdentityDeps {
  env: {
    ENVIRONMENT?: string;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    ACCESS_CERTS_URL?: string;
  };
  keyProvider?: KeyProvider;
  now?: () => number;
}

const SESSION_AUTH_FAILURES = new Set<AuthFailure['kind']>([
  'missing_config',
  'no_token',
  'invalid_token',
  'no_membership',
]);

export function isSessionFailure(failure: AuthFailure): boolean {
  return SESSION_AUTH_FAILURES.has(failure.kind);
}

export function certsUrlFor(teamDomain: string, overrideUrl?: string): string {
  return overrideUrl ?? `https://${teamDomain}/cdn-cgi/access/certs`;
}

/**
 * Resolves the portal identity for a request. Returns a failure reason on
 * any authentication problem; callers map failures to HTTP responses.
 */
export async function resolveIdentity(
  request: Request,
  db: D1Database,
  deps: IdentityDeps,
): Promise<{ ok: true; identity: PortalIdentity } | { ok: false; failure: AuthFailure }> {
  const authorization = request.headers.get('Authorization');
  if (authorization?.startsWith('Bearer ')) {
    return resolveMachineIdentity(db, authorization.slice('Bearer '.length));
  }
  return resolveSessionIdentity(request, db, deps);
}

async function resolveMachineIdentity(
  db: D1Database,
  credential: string,
): Promise<{ ok: true; identity: PortalIdentity } | { ok: false; failure: AuthFailure }> {
  const client = await findClientByCredential(db, credential);
  if (!client) return { ok: false, failure: { kind: 'invalid_credentials' } };
  if (client.status !== 'active') return { ok: false, failure: { kind: 'invalid_credentials' } };
  if (client.expiresAt && client.expiresAt < new Date().toISOString()) {
    return { ok: false, failure: { kind: 'invalid_credentials' } };
  }
  const scopes = client.allowedScopes;
  // Machine capabilities are derived from scopes, never from a human role:
  // machine clients can submit request types when they hold requests:write,
  // and can never cancel or comment (handlers enforce this independently).
  const identity: MachineIdentity = {
    kind: 'machine',
    client,
    customerId: client.customerId,
    scopes,
    capabilities: {
      requestTypes: scopes.includes('requests:write')
        ? ['renewal', 'capacity_increase', 'prepaid_credit', 'agent_access', 'license_support', 'deployment_support', 'general_support']
        : [],
      canCancel: false,
      canComment: false,
    },
  };
  // Fire-and-forget usage tracking; failures never break the request.
  void touchClientLastUsed(db, client.id).catch(() => undefined);
  return { ok: true, identity };
}

async function resolveSessionIdentity(
  request: Request,
  db: D1Database,
  deps: IdentityDeps,
): Promise<{ ok: true; identity: PortalIdentity } | { ok: false; failure: AuthFailure }> {
  const { ACCESS_TEAM_DOMAIN, ACCESS_AUD, ACCESS_CERTS_URL } = deps.env;
  if (!ACCESS_TEAM_DOMAIN || !ACCESS_AUD) {
    return { ok: false, failure: { kind: 'missing_config' } };
  }

  let token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token && deps.env.ENVIRONMENT !== 'production') {
    token = readDevCookie(request);
  }
  if (!token) return { ok: false, failure: { kind: 'no_token' } };

  const keyProvider =
    deps.keyProvider ?? new CertKeyProvider(certsUrlFor(ACCESS_TEAM_DOMAIN, ACCESS_CERTS_URL));
  try {
    const { claims } = await verifyAccessJwt(token, {
      teamDomain: ACCESS_TEAM_DOMAIN,
      audience: ACCESS_AUD,
      keyProvider,
      now: deps.now,
    });
    const email = claims.email;
    if (typeof email !== 'string' || email.trim() === '') {
      return { ok: false, failure: { kind: 'invalid_token' } };
    }
    const membership = await findActiveMembershipByEmail(db, email, deps.now);
    if (membership) {
      return {
        ok: true,
        identity: {
          kind: 'session',
          email: membership.emailNormalized,
          membership,
          customerId: membership.customerId,
          role: membership.role,
          capabilities: capabilitiesFor(membership.role),
        },
      };
    }
    const access = await findMembershipAccessStateByEmail(db, email, deps.now);
    if (access === 'disabled') return { ok: false, failure: { kind: 'access_disabled' } };
    if (access === 'expired') return { ok: false, failure: { kind: 'access_expired' } };
    return { ok: false, failure: { kind: 'not_provisioned' } };
  } catch (error) {
    if (error instanceof JwtVerificationError) {
      return { ok: false, failure: { kind: 'invalid_token' } };
    }
    return { ok: false, failure: { kind: 'invalid_token' } };
  }
}

function readDevCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === DEV_JWT_COOKIE_NAME) {
      const value = rest.join('=');
      return value.length > 0 ? value : null;
    }
  }
  return null;
}