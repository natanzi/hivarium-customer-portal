/** Shared app-level test fixture: real D1 + real JWT verification + adapters. */

import { createD1Harness, applyDevSeed, type D1Harness } from './d1';
import { generateTestKeyPair, signTestJwt, TEST_AUDIENCE, TEST_TEAM_DOMAIN, type TestKeyPair } from './jwt';
import { StaticKeyProvider } from '../../../worker/auth/access-jwt';
import { createApp, type PortalEnv } from '../../../worker/index';
import { MemoryOperatorService, MemoryLicenseService } from '../../../worker/services/test-adapters';
import type { OperatorPort } from '../../../worker/services/operator';
import type { LicensePort } from '../../../worker/services/license';
import { InMemoryRateLimiter } from '../../../worker/api/rate-limit';

export interface TestApp {
  harness: D1Harness;
  app: ReturnType<typeof createApp>;
  env: PortalEnv;
  keyPair: TestKeyPair;
  sign: (claims?: Parameters<typeof signTestJwt>[1], kid?: string) => string;
  close: () => Promise<void>;
}

type FetchHandler = (request: Request, env: PortalEnv) => Promise<Response>;

/**
 * Wraps the ExportedHandler's optional fetch (which takes an ExecutionContext)
 * into a plain two-argument function for test calls.
 */
export function appFetch(app: unknown): FetchHandler {
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
  const handler = app as { fetch: (request: unknown, env: PortalEnv, ctx: unknown) => Promise<Response> };
  return (request, env) => handler.fetch(request, env, ctx);
}

export interface TestAppOptions {
  seed?: boolean;
  environment?: string;
  teamDomain?: string;
  audience?: string;
  operator?: OperatorPort;
  license?: LicensePort;
  rateLimiter?: InMemoryRateLimiter;
  /** Omit ACCESS_TEAM_DOMAIN/ACCESS_AUD to simulate missing production config. */
  missingAuthConfig?: boolean;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const harness = await createD1Harness(`test-db-${Math.random().toString(36).slice(2, 8)}`);
  if (options.seed ?? true) await applyDevSeed(harness.db);

  const keyPair = generateTestKeyPair();
  const keyProvider = new StaticKeyProvider([{ ...keyPair.publicJwk, kid: 'test-kid', alg: 'RS256', use: 'sig' }]);

  const app = createApp({
    keyProvider,
    operator: options.operator ?? new MemoryOperatorService(),
    license: options.license ?? new MemoryLicenseService(),
    rateLimiter: options.rateLimiter,
  });

  const env: PortalEnv = {
    PORTAL_DB: harness.db,
    ENVIRONMENT: options.environment ?? 'test',
    ACCESS_TEAM_DOMAIN: options.missingAuthConfig ? undefined : (options.teamDomain ?? TEST_TEAM_DOMAIN),
    ACCESS_AUD: options.missingAuthConfig ? undefined : (options.audience ?? TEST_AUDIENCE),
  };

  return {
    harness,
    app,
    env,
    keyPair,
    sign: (claims, kid) => signTestJwt(keyPair, claims ?? {}, kid ?? 'test-kid'),
    close: () => harness.close(),
  };
}

export function sessionRequest(
  app: ReturnType<typeof createApp>,
  env: PortalEnv,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Cf-Access-Jwt-Assertion', token);
  return appFetch(app)(new Request(`https://portal.test${path}`, { ...init, headers }), env);
}

export function machineRequest(
  app: ReturnType<typeof createApp>,
  env: PortalEnv,
  credential: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${credential}`);
  return appFetch(app)(new Request(`https://portal.test${path}`, { ...init, headers }), env);
}

export async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}