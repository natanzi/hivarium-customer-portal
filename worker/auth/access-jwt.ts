/**
 * Cloudflare Access JWT verification.
 *
 * The Worker never trusts client-supplied identity headers. Authentication is
 * derived exclusively from the signed `Cf-Access-Jwt-Assertion` JWT that
 * Cloudflare Access attaches to every request passing its policy. In local
 * development the same token may be supplied through the `PORTAL_DEV_JWT`
 * cookie, which is accepted only when `ENVIRONMENT !== 'production'` and is
 * verified with the exact same cryptographic path.
 *
 * Verification fails closed:
 *  - missing team domain or audience configuration is a hard failure;
 *  - a missing, malformed, unsupported-algorithm, badly-signed, expired,
 *    wrong-audience or wrong-issuer token is rejected;
 *  - key fetching errors reject the request unless a fresh key cache exists.
 */

export interface JwkRsaKey {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

export interface KeyProvider {
  /** Returns the current set of signing keys. Must not throw. */
  getKeys(): Promise<JwkRsaKey[]>;
}

export type JwtFailureKind =
  | 'malformed'
  | 'unsupported_algorithm'
  | 'unknown_key'
  | 'bad_signature'
  | 'expired'
  | 'wrong_audience'
  | 'wrong_issuer'
  | 'not_yet_valid'
  | 'key_fetch_failed';

export class JwtVerificationError extends Error {
  readonly kind: JwtFailureKind;
  constructor(kind: JwtFailureKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface AccessJwtClaims {
  aud: string | string[];
  email?: string;
  sub?: string;
  iss?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
}

export interface VerifyOptions {
  teamDomain: string;
  audience: string;
  keyProvider: KeyProvider;
  /** Allowed clock skew in seconds. */
  clockSkewSeconds?: number;
  now?: () => number;
}

export interface VerifyResult {
  ok: true;
  claims: AccessJwtClaims;
  kid: string;
}

const MAX_KEY_CACHE_AGE_MS = 60 * 60 * 1000;

/** Fetches the Cloudflare Access signing keys from the team's certs endpoint. */
export class CertKeyProvider implements KeyProvider {
  private cache: { keys: JwkRsaKey[]; fetchedAt: number; maxAgeMs: number } | null = null;

  constructor(
    private readonly certsUrl: string,
    // Arrow closure: calling the global fetch through an instance property
    // otherwise breaks its `this` binding inside workerd.
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}

  async getKeys(): Promise<JwkRsaKey[]> {
    const now = Date.now();
    if (this.cache && now < this.cache.fetchedAt + Math.min(this.cache.maxAgeMs, MAX_KEY_CACHE_AGE_MS)) {
      return this.cache.keys;
    }
    try {
      const response = await this.fetcher(this.certsUrl);
      if (!response.ok) throw new Error(`certs endpoint returned ${response.status}`);
      const body = (await response.json()) as { keys?: JwkRsaKey[] };
      if (!Array.isArray(body.keys) || body.keys.length === 0) {
        throw new Error('certs endpoint returned no keys');
      }
      const keys = body.keys.filter((k) => k.kty === 'RSA' && k.n && k.e && k.kid);
      if (keys.length === 0) throw new Error('certs endpoint returned no usable RSA keys');
      const maxAgeMs = parseMaxAge(response.headers.get('Cache-Control'), 300) * 1000;
      this.cache = { keys, fetchedAt: now, maxAgeMs };
      return keys;
    } catch {
      // Serve a fresh (unexpired) cached copy if we have one; otherwise fail closed.
      if (this.cache && now < this.cache.fetchedAt + MAX_KEY_CACHE_AGE_MS) {
        return this.cache.keys;
      }
      this.cache = null;
      return [];
    }
  }

  /** Force a refetch after a kid miss (key rotation window). */
  async refetch(): Promise<JwkRsaKey[]> {
    this.cache = null;
    return this.getKeys();
  }
}

function parseMaxAge(cacheControl: string | null, fallback: number): number {
  if (!cacheControl) return fallback;
  const match = /max-age=(\d+)/.exec(cacheControl);
  if (!match) return fallback;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return Math.min(seconds, MAX_KEY_CACHE_AGE_MS / 1000);
}

function base64UrlDecode(part: string): Uint8Array {
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Verifies a Cloudflare Access JWT (RS256) and returns its claims.
 * Throws JwtVerificationError on any failure.
 */
export async function verifyAccessJwt(
  token: string,
  options: VerifyOptions,
): Promise<VerifyResult> {
  const { teamDomain, audience, keyProvider } = options;
  const nowSeconds = Math.floor((options.now ? options.now() : Date.now()) / 1000);
  const skew = options.clockSkewSeconds ?? 60;

  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtVerificationError('malformed', 'Token is malformed.');

  let header: { alg?: string; kid?: string };
  let claims: AccessJwtClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
  } catch {
    throw new JwtVerificationError('malformed', 'Token header or payload is not valid JSON.');
  }

  if (header.alg !== 'RS256') {
    throw new JwtVerificationError('unsupported_algorithm', 'Only RS256 is accepted.');
  }
  if (!header.kid) throw new JwtVerificationError('malformed', 'Token has no key id.');

  const expectedIssuer = `https://${teamDomain}`;
  if (claims.iss !== expectedIssuer) {
    throw new JwtVerificationError('wrong_issuer', 'Token issuer does not match.');
  }

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience)) {
    throw new JwtVerificationError('wrong_audience', 'Token audience does not match.');
  }

  if (typeof claims.exp !== 'number' || claims.exp + skew < nowSeconds) {
    throw new JwtVerificationError('expired', 'Token is expired.');
  }
  if (typeof claims.nbf === 'number' && claims.nbf - skew > nowSeconds) {
    throw new JwtVerificationError('not_yet_valid', 'Token is not yet valid.');
  }
  if (typeof claims.iat === 'number' && claims.iat - skew > nowSeconds) {
    throw new JwtVerificationError('not_yet_valid', 'Token has an invalid issued-at time.');
  }

  let keys = await keyProvider.getKeys();
  let key = keys.find((k) => k.kid === header.kid);
  if (!key) {
    // Possible rotation window: force a refetch once, then fail closed.
    if (keyProvider instanceof CertKeyProvider) {
      keys = await keyProvider.refetch();
      key = keys.find((k) => k.kid === header.kid);
    }
    if (!key) {
      throw new JwtVerificationError('unknown_key', 'Signing key is unknown.');
    }
  }

  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = base64UrlDecode(parts[2]);
  const data = new TextEncoder().encode(signingInput);

  let verified: boolean;
  try {
    const imported = await crypto.subtle.importKey(
      'jwk',
      { kty: key.kty, n: key.n, e: key.e, alg: 'RS256', use: 'sig' },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      imported,
      signature as unknown as BufferSource,
      data,
    );
  } catch {
    throw new JwtVerificationError('bad_signature', 'Token signature could not be verified.');
  }

  if (!verified) throw new JwtVerificationError('bad_signature', 'Token signature is invalid.');

  return { ok: true, claims, kid: header.kid };
}

/** Static key provider for deterministic tests and local tooling. */
export class StaticKeyProvider implements KeyProvider {
  constructor(private readonly keys: JwkRsaKey[]) {}
  async getKeys(): Promise<JwkRsaKey[]> {
    return this.keys;
  }
}

export { base64UrlEncode, base64UrlDecode };