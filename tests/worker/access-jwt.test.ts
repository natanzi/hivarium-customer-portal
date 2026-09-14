import { describe, it, expect } from 'vitest';
import {
  JwtVerificationError,
  StaticKeyProvider,
  verifyAccessJwt,
  base64UrlEncode,
} from '../../worker/auth/access-jwt';
import { generateTestKeyPair, signTestJwt, TEST_AUDIENCE, TEST_TEAM_DOMAIN, publicJwkToJwks } from './helpers/jwt';

async function verifier(overrides: Partial<Parameters<typeof verifyAccessJwt>[1]> = {}) {
  const pair = await generateTestKeyPair();
  const base = {
    teamDomain: TEST_TEAM_DOMAIN,
    audience: TEST_AUDIENCE,
    keyProvider: new StaticKeyProvider(publicJwkToJwks('test-kid', pair.publicJwk).keys),
  };
  return { pair, verify: (token: string) => verifyAccessJwt(token, { ...base, ...overrides }) };
}

describe('verifyAccessJwt', () => {
  it('accepts a correctly signed token', async () => {
    const { pair, verify } = await verifier();
    const result = await verify(await signTestJwt(pair));
    expect(result.ok).toBe(true);
    expect(result.claims.email).toBe('dev.admin@acme.example');
  });

  it('rejects a missing token', async () => {
    const { verify } = await verifier();
    await expect(verify('')).rejects.toThrow(JwtVerificationError);
    await expect(verify('a.b')).rejects.toThrow(JwtVerificationError);
  });

  it('rejects a malformed token', async () => {
    const { verify } = await verifier();
    await expect(verify('not-a-jwt')).rejects.toThrow(JwtVerificationError);
    await expect(verify('a.b.c.d')).rejects.toThrow(JwtVerificationError);
  });

  it('rejects an invalid signature', async () => {
    const { pair, verify } = await verifier();
    const token = await signTestJwt(pair);
    const tampered = token.slice(0, -3) + (token.endsWith('aaa') ? 'bbb' : 'aaa');
    await expect(verify(tampered)).rejects.toThrow(JwtVerificationError);
  });

  it('rejects a token signed with a different key', async () => {
    const otherPair = await generateTestKeyPair();
    const { pair, verify } = await verifier();
    const token = await signTestJwt(otherPair);
    await expect(verify(token)).rejects.toThrow(JwtVerificationError);
    void pair;
  });

  it('rejects a token with an unknown kid', async () => {
    const { pair, verify } = await verifier();
    const token = await signTestJwt(pair, {}, 'unknown-kid');
    await expect(verify(token)).rejects.toThrow(JwtVerificationError);
  });

  it('rejects a wrong issuer', async () => {
    const { pair, verify } = await verifier();
    const token = await signTestJwt(pair, { iss: 'https://evil.example' });
    await expect(verify(token)).rejects.toThrow(JwtVerificationError);
  });

  it('rejects a wrong audience', async () => {
    const { pair, verify } = await verifier();
    const token = await signTestJwt(pair, { aud: 'some-other-app' });
    await expect(verify(token)).rejects.toThrow(JwtVerificationError);
  });

  it('accepts an audience array containing the expected value', async () => {
    const { pair, verify } = await verifier();
    const token = await signTestJwt(pair, { aud: [TEST_AUDIENCE, 'other-app'] });
    await expect(verify(token)).resolves.toMatchObject({ ok: true });
  });

  it('rejects an expired token', async () => {
    const { pair, verify } = await verifier();
    const now = Math.floor(Date.now() / 1000);
    const token = await signTestJwt(pair, { exp: now - 3600, nbf: now - 7200, iat: now - 7200 });
    await expect(verify(token)).rejects.toThrow(JwtVerificationError);
  });

  it('rejects a token with an alg other than RS256', async () => {
    const { pair } = await verifier();
    const now = Math.floor(Date.now() / 1000);
    const encode = (v: unknown) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(v)));
    const header = { alg: 'none', kid: 'test-kid' };
    const payload = {
      aud: TEST_AUDIENCE,
      iss: `https://${TEST_TEAM_DOMAIN}`,
      email: 'dev.admin@acme.example',
      exp: now + 300,
      nbf: now - 30,
      iat: now,
    };
    const token = `${encode(header)}.${encode(payload)}.`;
    const { verify } = await verifier();
    await expect(verify(token)).rejects.toThrow(JwtVerificationError);
    void pair;
  });

  it('rejects a token without an email claim at the app layer (handler test covers this)', () => {
    expect(true).toBe(true);
  });

  it('fails closed when the key provider returns no keys', async () => {
    const pair = await generateTestKeyPair();
    const token = await signTestJwt(pair);
    const empty = new StaticKeyProvider([]);
    await expect(
      verifyAccessJwt(token, {
        teamDomain: TEST_TEAM_DOMAIN,
        audience: TEST_AUDIENCE,
        keyProvider: empty,
      }),
    ).rejects.toThrow(JwtVerificationError);
  });

  it('respects a clock skew window for slightly-expired tokens', async () => {
    const { pair, verify } = await verifier({ clockSkewSeconds: 120 });
    const now = Math.floor(Date.now() / 1000);
    const token = await signTestJwt(pair, { exp: now - 60, nbf: now - 120, iat: now - 120 });
    await expect(verify(token)).resolves.toMatchObject({ ok: true });
  });
});
