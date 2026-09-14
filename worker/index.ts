/**
 * Hivarium Customer Portal — Cloudflare Worker entry point.
 *
 * Responsibilities:
 *  - serve the SPA assets with security headers;
 *  - redirect `/` to `/overview` for browsers;
 *  - expose the same-origin `/api/*` boundary;
 *  - authenticate every API request (Cloudflare Access JWT or machine
 *    credential), fail closed, and derive tenancy on the server;
 *  - enforce Origin checks for browser mutations, strict Content-Type checks,
 *    body-size limits and a safe error envelope;
 *  - aggregate only the customer-authorized subset of Operator Console and
 *    License Service state through typed ports that fail closed.
 */

import type { Capabilities, PortalRole } from '../shared/types';
import { resolveIdentity, type IdentityDeps } from './auth/context';
import { type KeyProvider } from './auth/access-jwt';
import { FetchOperatorService, type OperatorPort } from './services/operator';
import { FetchLicenseService, type LicensePort } from './services/license';
import { ApiError, errorEnvelope } from './api/errors';
import {
  handleAccountStatus,
  handleAddComment,
  handleAgents,
  handleCancelRequest,
  handleCreateRequest,
  handleLicenses,
  handleListRequests,
  handleOverview,
  handleRequestDetail,
  handleSubscription,
  handleUsage,
  type HandlerContext,
} from './api/handlers';
import { InMemoryRateLimiter, MACHINE_RATE_LIMIT, MACHINE_RATE_WINDOW_MS } from './api/rate-limit';
import { newCorrelationId } from './util';

export interface PortalEnv {
  PORTAL_DB: D1Database;
  ASSETS?: Fetcher;
  ENVIRONMENT: string;
  /** Cloudflare Access team domain, e.g. `hivarium.cloudflareaccess.com`. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Expected JWT audience (the Access application AUD). */
  ACCESS_AUD?: string;
  /** Optional certs URL override. Production uses the default CF endpoint. */
  ACCESS_CERTS_URL?: string;
  /** Cloudflare Service Bindings (production). Optional in this MVP. */
  OPERATOR_SERVICE?: Fetcher;
  LICENSE_SERVICE?: Fetcher;
  /** Local-only URL overrides for `wrangler dev` and E2E. Never set in production. */
  OPERATOR_SERVICE_URL?: string;
  LICENSE_SERVICE_URL?: string;
}

const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

const MAX_BODY_BYTES = 64 * 1024;

function json(payload: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  return Response.json(payload, { status, headers });
}

function errorResponse(error: ApiError, requestId: string): Response {
  return json(errorEnvelope(error.code, error.message, requestId), error.status, {
    'x-request-id': requestId,
  });
}

export interface AppExtensions {
  keyProvider?: KeyProvider;
  now?: () => number;
  rateLimiter?: InMemoryRateLimiter;
  /** Test-only: deterministic in-memory service adapters. */
  operator?: OperatorPort;
  license?: LicensePort;
}

function buildOperatorPort(env: PortalEnv): FetchOperatorService {
  return new FetchOperatorService({
    binding: env.OPERATOR_SERVICE,
    urlOverride: env.OPERATOR_SERVICE_URL,
  });
}

function buildLicensePort(env: PortalEnv): FetchLicenseService {
  return new FetchLicenseService({
    binding: env.LICENSE_SERVICE,
    urlOverride: env.LICENSE_SERVICE_URL,
  });
}

function withRequestId(headers: Headers, requestId: string): Headers {
  headers.set('x-request-id', requestId);
  return headers;
}

/**
 * Origin verification for browser mutations: a request carrying an Origin
 * header whose host does not match the request host is rejected. Machine
 * clients authenticate with a credential, so no Origin check is applied.
 */
function verifyOrigin(request: Request, url: URL, identityKind: 'session' | 'machine'): void {
  if (identityKind === 'machine') return;
  const origin = request.headers.get('Origin');
  if (!origin) return;
  try {
    const originUrl = new URL(origin);
    if (originUrl.host !== url.host) {
      throw new ApiError(403, 'forbidden', 'Cross-origin mutations are not allowed.');
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(403, 'forbidden', 'Cross-origin mutations are not allowed.');
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  }
  const declared = request.headers.get('Content-Length');
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    throw new ApiError(413, 'payload_too_large', 'Request body is too large.');
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new ApiError(413, 'payload_too_large', 'Request body is too large.');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, 'validation_error', 'Request body is not valid JSON.');
  }
}

async function handleApi(request: Request, env: PortalEnv, url: URL, extensions: AppExtensions): Promise<Response> {
  const requestId = newCorrelationId();
  const method = request.method;

  // Liveness probe: no data exposure, no auth required.
  if (method === 'GET' && url.pathname === '/api/health') {
    return json({ service: 'hivarium-customer-portal', status: 'ok' }, 200, { 'x-request-id': requestId });
  }

  if (!url.pathname.startsWith('/api/v1/')) {
    return json(errorEnvelope('not_found', 'Unknown API route.', requestId), 404, { 'x-request-id': requestId });
  }

  const authDeps: IdentityDeps = {
    env: {
      ENVIRONMENT: env.ENVIRONMENT,
      ACCESS_TEAM_DOMAIN: env.ACCESS_TEAM_DOMAIN,
      ACCESS_AUD: env.ACCESS_AUD,
      ACCESS_CERTS_URL: env.ACCESS_CERTS_URL,
    },
    keyProvider: extensions.keyProvider,
    now: extensions.now,
  };

  const auth = await resolveIdentity(request, env.PORTAL_DB, authDeps);
  if (!auth.ok) {
    const failure = auth.failure;
    if (failure.kind === 'missing_config') {
      return json(errorEnvelope('service_unavailable', 'Authentication is not configured. Please try again later.', requestId), 503, { 'x-request-id': requestId });
    }
    if (failure.kind === 'invalid_credentials') {
      return json(errorEnvelope('unauthorized', 'Invalid credentials.', requestId), 401, { 'x-request-id': requestId });
    }
    // no_token, invalid_token, no_membership: identical envelope — never
    // reveal whether an email is a portal member.
    return json(errorEnvelope('unauthorized', 'Sign-in required.', requestId), 401, { 'x-request-id': requestId });
  }

  const identity = auth.identity;

  // Machine-client rate limiting (per-isolate; see docs/security.md).
  if (identity.kind === 'machine') {
    const limiter = extensions.rateLimiter ?? new InMemoryRateLimiter(MACHINE_RATE_LIMIT, MACHINE_RATE_WINDOW_MS);
    const decision = limiter.allow(identity.client.id);
    if (!decision.ok) {
      return json(
        errorEnvelope('too_many_requests', 'Rate limit exceeded.', requestId),
        429,
        { 'x-request-id': requestId, 'retry-after': String(decision.retryAfterSeconds ?? 1) },
      );
    }
  }

  const ctx: HandlerContext = {
    db: env.PORTAL_DB,
    identity,
    correlationId: requestId,
    operator: extensions.operator ?? buildOperatorPort(env),
    license: extensions.license ?? buildLicensePort(env),
  };

  const segments = url.pathname.split('/').filter(Boolean); // ["api", "v1", ...]

  try {
    // Browser mutations require a same-host Origin.
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (mutating) {
      verifyOrigin(request, url, identity.kind);
    }
    // ---- account ---------------------------------------------------------
    if (method === 'GET' && segments[2] === 'account' && segments[3] === 'status') {
      const body = await handleAccountStatus(ctx);
      return json(body, 200, { 'x-request-id': requestId });
    }

    // ---- read sections ----------------------------------------------------
    if (method === 'GET' && segments[2] === 'overview') {
      const body = await handleOverview(ctx);
      return json(body, 200, { 'x-request-id': requestId });
    }
    if (method === 'GET' && segments[2] === 'subscription') {
      const body = await handleSubscription(ctx);
      return json(body, 200, { 'x-request-id': requestId });
    }
    if (method === 'GET' && segments[2] === 'agents') {
      const body = await handleAgents(ctx);
      return json(body, 200, { 'x-request-id': requestId });
    }
    if (method === 'GET' && segments[2] === 'licenses') {
      const body = await handleLicenses(ctx);
      return json(body, 200, { 'x-request-id': requestId });
    }
    if (method === 'GET' && segments[2] === 'usage') {
      const body = await handleUsage(ctx);
      return json(body, 200, { 'x-request-id': requestId });
    }

    // ---- requests --------------------------------------------------------
    if (segments[2] === 'requests') {
      if (method === 'GET' && segments.length === 3) {
        const body = await handleListRequests(ctx, {
          page: url.searchParams.get('page') ?? undefined,
          pageSize: url.searchParams.get('pageSize') ?? undefined,
          status: url.searchParams.get('status') ?? undefined,
        });
        return json(body, 200, { 'x-request-id': requestId });
      }
      if (method === 'POST' && segments.length === 3) {
        const body = await readJsonBody(request);
        const result = await handleCreateRequest(ctx, body, request.headers.get('Idempotency-Key'));
        return json(result, result.replayed ? 200 : 201, { 'x-request-id': requestId });
      }
      if (segments.length === 4 && method === 'GET') {
        const body = await handleRequestDetail(ctx, segments[3]);
        return json(body, 200, { 'x-request-id': requestId });
      }
      if (segments.length === 5 && method === 'POST' && segments[4] === 'cancel') {
        const body = await handleCancelRequest(ctx, segments[3]);
        return json(body, 200, { 'x-request-id': requestId });
      }
      if (segments.length === 5 && method === 'POST' && segments[4] === 'comments') {
        const bodyJson = await readJsonBody(request);
        const body = await handleAddComment(ctx, segments[3], bodyJson);
        return json(body, 201, { 'x-request-id': requestId });
      }
    }

    return json(errorEnvelope('not_found', 'Unknown API route.', requestId), 404, { 'x-request-id': requestId });
  } catch (error) {
    if (error instanceof ApiError) {
      return errorResponse(error, requestId);
    }
    // Never leak internals.
    return json(errorEnvelope('internal_error', 'An unexpected error occurred.', requestId), 500, { 'x-request-id': requestId });
  }
}

export function createApp(extensions: AppExtensions = {}): ExportedHandler<PortalEnv> {
  return {
    async fetch(request: Request, env: PortalEnv): Promise<Response> {
      const url = new URL(request.url);

      // Root behavior: browsers are redirected to /overview immediately so the
      // app never stalls on a client-side redirect hop.
      if (request.method === 'GET' && url.pathname === '/' && wantsHtml(request)) {
        return Response.redirect(new URL('/overview', request.url).toString(), 307);
      }

      if (url.pathname.startsWith('/api/')) {
        return handleApi(request, env, url, extensions);
      }

      if (!env.ASSETS) {
        return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
      }

      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    },
  };
}

function wantsHtml(request: Request): boolean {
  const accept = request.headers.get('Accept') ?? '';
  return accept.includes('text/html') || accept.includes('application/xhtml+xml');
}

export default createApp();

export { buildOperatorPort, buildLicensePort };