/**
 * Magic-link delivery through a configured HTTPS email provider.
 *
 * Sends a minimal HTML/text sign-in email whose link embeds the raw
 * challenge token, encoded with `URLSearchParams` so the token can never
 * be mis-parsed. Security properties:
 *
 *   * `PORTAL_BASE_URL` must be an absolute HTTPS URL; anything else is a
 *     typed configuration failure, so a link can never point at a
 *     non-portal or non-HTTPS origin.
 *   * `EMAIL_PROVIDER_URL` defaults to the Resend API and may be overridden
 *     (e.g. a local mail stub in development); the value must be HTTPS.
 *   * The API key is sent ONLY in the `Authorization` header. It is never
 *     logged, echoed in errors, or included in any payload or return
 *     value. All failures surface as `MagicLinkEmailError` with a fixed,
 *     safe message.
 */

export interface MagicLinkEnv {
  /** Absolute HTTPS base URL of the portal, e.g. `https://portal.hivarium.dev`. */
  PORTAL_BASE_URL?: string;
  /** Email provider API key (e.g. a Resend `re_...` key). */
  EMAIL_PROVIDER_API_KEY?: string;
  /** Email sender address used for the `from` header. */
  EMAIL_FROM_ADDRESS?: string;
  /** Optional `reply-to` address. */
  EMAIL_REPLY_TO?: string;
  /** Optional provider endpoint override; defaults to the Resend API. Must be HTTPS. */
  EMAIL_PROVIDER_URL?: string;
  /** Optional recipient display/subject name; defaults to 'Hivarium'. */
  PORTAL_NAME?: string;
}

export const DEFAULT_EMAIL_PROVIDER_URL = 'https://api.resend.com/emails';

export type MagicLinkEmailFailureKind =
  | 'missing_config'
  | 'config_invalid'
  | 'provider_error'
  | 'network_error'
  | 'invalid_response'
  | 'unknown';

/**
 * Typed failure for magic-link email delivery. `kind` is safe to log; only
 * the fixed `message` and `kind` are ever surfaced. Provider response
 * details are deliberately dropped from the error so no credential or
 * recipient data leaks through error paths.
 */
export class MagicLinkEmailError extends Error {
  readonly kind: MagicLinkEmailFailureKind;

  constructor(kind: MagicLinkEmailFailureKind, message: string) {
    super(message);
    this.name = 'MagicLinkEmailError';
    this.kind = kind;
  }
}

/**
 * Builds the sign-in URL for a raw challenge token. The token is embedded
 * via `URLSearchParams` so special characters are percent-encoded. The path
 * is always `/api/auth/verify` on the configured origin — the only verify
 * route the Worker exposes — regardless of any base path in `PORTAL_BASE_URL`.
 */
export function buildMagicLinkUrl(baseUrl: string, token: string): string {
  const base = new URL(baseUrl);
  const params = new URLSearchParams({ token });
  return `${base.origin}/login/verify#${params.toString()}`;
}

/** Validates a configured base URL: absolute, HTTPS, non-empty host. */
export function isValidPortalBaseUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (url.username !== '' || url.password !== '') return false;
    if (url.hostname === '' || url.hostname === 'localhost') return false;
    return true;
  } catch {
    return false;
  }
}

function isValidProviderUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname !== '';
  } catch {
    return false;
  }
}

export interface MagicLinkEmailParams {
  /** Normalized recipient email address. */
  to: string;
  /** Raw challenge token; must be a non-empty URL-safe value. */
  token: string;
  /** Absolute HTTPS portal base URL. */
  baseUrl: string;
  /** Email provider API key. */
  apiKey: string;
  /** Email sender address. */
  from: string;
  /** Provider endpoint; defaults to the Resend API. */
  apiUrl?: string;
  /** Optional reply-to address. */
  replyTo?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function emailToName(email: string): string {
  const at = email.indexOf('@');
  const local = (at > 0 ? email.slice(0, at) : email).trim();
  return local.length > 0 ? local : 'there';
}

/**
 * Sends the magic-link email through the configured provider.
 *
 * Resolves a configuration error (`missing_config` / `config_invalid`)
 * before any network I/O. On provider failure, throws
 * `MagicLinkEmailError` with a safe, fixed message; never logs or returns
 * the API key, and never includes provider response bodies in the error.
 */
export async function sendMagicLinkEmail(params: MagicLinkEmailParams): Promise<void> {
  const { to, token, baseUrl, apiKey, from, replyTo } = params;
  const apiUrl = params.apiUrl ?? DEFAULT_EMAIL_PROVIDER_URL;

  if (!isValidPortalBaseUrl(baseUrl)) {
    throw new MagicLinkEmailError('config_invalid', 'PORTAL_BASE_URL must be an absolute HTTPS URL.');
  }
  if (!isValidProviderUrl(apiUrl)) {
    throw new MagicLinkEmailError('config_invalid', 'Email provider URL must be an absolute HTTPS URL.');
  }
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new MagicLinkEmailError('missing_config', 'Email provider API key is not configured.');
  }
  if (typeof from !== 'string' || from.length === 0) {
    throw new MagicLinkEmailError('missing_config', 'Email sender (from) address is not configured.');
  }
  if (typeof to !== 'string' || to.length === 0) {
    throw new MagicLinkEmailError('missing_config', 'Email recipient is not configured.');
  }
  if (typeof token !== 'string' || token.length === 0) {
    throw new MagicLinkEmailError('config_invalid', 'Challenge token is empty.');
  }

  const linkUrl = buildMagicLinkUrl(baseUrl, token);
  const name = emailToName(to);

  const subject = 'Sign in to Hivarium';
  const text = [
    `Hi ${name},`,
    '',
    'You requested a magic sign-in link for the Hivarium portal.',
    '',
    'Sign in: ' + linkUrl,
    '',
    'This link expires in 10 minutes and can only be used once.',
    'If you did not request this, you can safely ignore this email; no one else can use the link.',
  ].join('\n');

  const html = [
    '<!doctype html>',
    '<html>',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    '<body style="margin:0;padding:0;background:#f6f5f1;">',
    '<div style="max-width:560px;margin:0 auto;padding:48px 24px;font-family:ui-sans-serif,system-ui,-apple-system,\'Segoe UI\',sans-serif;color:#1e3d2f;">',
    '<h1 style="font-size:20px;font-weight:600;margin:0 0 16px;">Sign in to Hivarium</h1>',
    `<p style="font-size:15px;line-height:1.55;margin:0 0 24px;">You requested a magic sign-in link for your Hivarium portal account.</p>`,
    `<a href="${escapeHtml(linkUrl)}" style="display:inline-block;background:#b4552d;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:6px;">Sign in</a>`,
    `<p style="font-size:13px;line-height:1.5;margin:24px 0 0;color:#5c6f63;">This link expires in 10 minutes and can only be used once. If you did not request it, you can safely ignore this email.</p>`,
    '</div>',
    '</body>',
    '</html>',
  ].join('');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const body: Record<string, unknown> = {
    from,
    to: [to],
    subject,
    text,
    html,
  };
  if (typeof replyTo === 'string' && replyTo.length > 0) body.reply_to = replyTo;

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new MagicLinkEmailError('network_error', 'Could not reach the email provider.');
  }

  if (!response.ok) {
    throw new MagicLinkEmailError('provider_error', 'The email provider rejected the request.');
  }

  try {
    const parsed = (await response.json()) as { id?: string };
    if (!parsed || typeof parsed.id !== 'string' || parsed.id.length === 0) {
      throw new MagicLinkEmailError('invalid_response', 'The email provider returned an unexpected response.');
    }
  } catch (error) {
    if (error instanceof MagicLinkEmailError) throw error;
    throw new MagicLinkEmailError('invalid_response', 'The email provider returned an unexpected response.');
  }
}
