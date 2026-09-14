/**
 * Test helpers: real RS256 JWTs signed with a locally generated keypair.
 *
 * These tokens are verified by the real `verifyAccessJwt` path (WebCrypto),
 * so the signature, issuer, audience and expiry checks are exercised for
 * real. The matching public JWK is served by a StaticKeyProvider.
 */

import { base64UrlEncode, type JwkRsaKey } from '../../../worker/auth/access-jwt';

export const TEST_TEAM_DOMAIN = 'portal.test';
export const TEST_AUDIENCE = 'portal-e2e-aud';

export interface TestKeyPair {
  privateKey: CryptoKey;
  publicJwk: JwkRsaKey;
}

export async function generateTestKeyPair(): Promise<TestKeyPair> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const publicJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return {
    privateKey: pair.privateKey,
    publicJwk: {
      kid: 'test-kid',
      kty: publicJwk.kty ?? 'RSA',
      n: publicJwk.n ?? '',
      e: publicJwk.e ?? '',
      alg: 'RS256',
      use: 'sig',
    },
  };
}

export function publicJwkToJwks(kid: string, key: JwkRsaKey): { keys: JwkRsaKey[] } {
  return { keys: [{ ...key, kid, alg: 'RS256', use: 'sig' }] };
}

export async function signTestJwt(
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
): Promise<string> {
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
  const encodeJson = (value: unknown) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    pair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export function randomIdempotencyKey(): string {
  return `test-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}
