/** Shared app-level test fixture: Worker-runtime D1 + real JWT verification + adapters. */

import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env as workerEnv } from 'cloudflare:workers';
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
  sign: (claims?: Parameters<typeof signTestJwt>[1], kid?: string) => Promise<string>;
  close: () => Promise<void>;
}

type FetchHandler = (request: Request, env: PortalEnv) => Promise<Response>;

/**
 * Invokes the Worker's fetch handler with a real ExecutionContext from
 * cloudflare:test rather than a Node-only stub.
 */
export function appFetch(app: unknown): FetchHandler {
  const handler = app as {
    fetch: (request: Request, env: PortalEnv, ctx: ExecutionContext) => Promise<Response>;
  };
  return async (request, env) => {
    const ctx = createExecutionContext();
    const response = await handler.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    return response;
  };
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
  const harness = createD1Harness();
  if (options.seed ?? true) await applyDevSeed(harness.db);

  const keyPair = await generateTestKeyPair();
  const keyProvider = new StaticKeyProvider([{ ...keyPair.publicJwk, kid: 'test-kid', alg: 'RS256', use: 'sig' }]);

  const app = createApp({
    keyProvider,
    operator: options.operator ?? new MemoryOperatorService(),
    license: options.license ?? new MemoryLicenseService(),
    rateLimiter: options.rateLimiter,
  });

  const env: PortalEnv = {
    PORTAL_DB: workerEnv.PORTAL_DB,
    ASSETS: workerEnv.ASSETS,
    ENVIRONMENT: options.environment ?? workerEnv.ENVIRONMENT ?? 'test',
    ACCESS_TEAM_DOMAIN: options.missingAuthConfig ? undefined : (options.teamDomain ?? workerEnv.ACCESS_TEAM_DOMAIN ?? TEST_TEAM_DOMAIN),
    ACCESS_AUD: options.missingAuthConfig ? undefined : (options.audience ?? workerEnv.ACCESS_AUD ?? TEST_AUDIENCE),
    OPERATOR_SERVICE: workerEnv.OPERATOR_SERVICE,
    LICENSE_SERVICE: workerEnv.LICENSE_SERVICE,
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
