/**
 * Test helpers: real RS256 JWTs signed with a locally generated keypair.
 *
 * These tokens are verified by the real `verifyAccessJwt` path (WebCrypto),
 * so the signature, issuer, audience and expiry checks are exercised for
 * real. The matching public JWK is served by a StaticKeyProvider.
 */

import { generateKeyPairSync, sign } from "node:crypto";
import { Buffer } from "node:buffer";
import type { JwkRsaKey } from '../../../worker/auth/access-jwt';

export const TEST_TEAM_DOMAIN = 'portal.test';
export const TEST_AUDIENCE = 'portal-e2e-aud';

export interface TestKeyPair {
  privateKey: import('node:crypto').KeyObject;
  publicJwk: JwkRsaKey;
}

export function generateTestKeyPair(): TestKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: 'jwk' }) as unknown as JwkRsaKey;
  return { privateKey, publicJwk };
}

export function publicJwkToJwks(kid: string, key: JwkRsaKey): { keys: JwkRsaKey[] } {
  return { keys: [{ ...key, kid, alg: 'RS256', use: 'sig' }] };
}

export function signTestJwt(
  pair: TestKeyPair,
  claims: {
    aud?: string | string[];
    iss?: string;
    email?: string;
    sub?: string;
    exp?: number;
    nbf?: number;
    iat?: number;
  } = {},
  kid = 'test-kid',
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const payload = {
    aud: claims.aud ?? TEST_AUDIENCE,
    iss: claims.iss ?? `https://${TEST_TEAM_DOMAIN}`,
    email: claims.email ?? 'dev.admin@acme.example',
    sub: claims.sub ?? 'test-sub',
    exp: claims.exp ?? nowSeconds + 300,
    nbf: claims.nbf ?? nowSeconds - 30,
    iat: claims.iat ?? nowSeconds,
    ...claims,
  };
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signatureBytes = sign('RSA-SHA256', Buffer.from(signingInput, 'utf8'), pair.privateKey);
  // Buffer + combined node/workers typings disagree on toString overloads;
  // the cast is confined to this test helper.
  const signature = (signatureBytes as unknown as { toString: (e: string) => string }).toString('base64url');
  return `${signingInput}.${signature}`;
}

export function randomIdempotencyKey(): string {
  return `test-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

