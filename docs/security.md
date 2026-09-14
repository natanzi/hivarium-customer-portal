# Security model

## Authentication

The portal is behind Cloudflare Access. The Worker additionally verifies
every API request:

- **Session actors**: the `Cf-Access-Jwt-Assertion` header is verified
  cryptographically (RS256, issuer `https://<ACCESS_TEAM_DOMAIN>`, audience
  `ACCESS_AUD`, expiry, not-before, key id). Signing keys are fetched from the
  team certs endpoint (`https://<team-domain>/cdn-cgi/access/certs`), cached
  with `Cache-Control: max-age` awareness (capped at 1 hour), refreshed on a
  key-id miss, and fail closed if the endpoint is unreachable without a fresh
  cache.
- **Machine actors**: an `hv_`-prefixed credential in the `Authorization`
  header is matched by SHA-256 hash against `api_clients`. The raw credential
  is never stored or logged. Status must be `active` and the credential must
  not be expired.
- **Operator Console service principal**: inbound `/service/v1/*` calls
  present `Authorization: Bearer` matching the `OPERATOR_CALLER_TOKEN` secret
  (equal to the console's `PORTAL_SERVICE_TOKEN`). Comparison is timing-safe
  via SHA-256 digests. `X-Service-Name` is not trusted. The verified
  principal is `{ principalType: "service", serviceName: "operator-console" }`.
  Session JWTs and machine credentials cannot authorize these routes. Missing
  `OPERATOR_CALLER_TOKEN` fails closed (`503`).
- **Fail closed**: if `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is missing, every
  `/api/v1/*` request returns `503 service_unavailable`. A missing, malformed,
  badly signed, expired, wrong-issuer or wrong-audience token returns `401
  unauthorized`. Unauthenticated callers (missing or invalid token) share an
  identical `401` envelope. After a verified Access JWT, an email with no
  membership returns `403 not_provisioned`, a disabled membership returns
  `403 access_disabled`, and an expired evaluation membership returns
  `403 access_expired`. None of those 403 bodies include other customers'
  identifiers.
- **Local development only**: when `ENVIRONMENT !== 'production'`, the
  identically-verified JWT may arrive via the `PORTAL_DEV_JWT` cookie. The
  deployed Worker (`ENVIRONMENT=production` in `wrangler.jsonc`) never accepts
  the cookie.

## Tenant isolation

- The active customer id and portal role are derived exclusively server-side
  from `portal_memberships` in `PORTAL_DB`, keyed on the verified email.
- Every repository query and mutation is bound to the verified
  `customer_id`; client-supplied customer ids, emails, roles and tenant ids
  are never accepted.
- Cross-tenant lookups return the exact same `404 not_found` envelope as a
  genuinely missing record.
- An email mapping to more than one active customer is rejected as ambiguous
  rather than guessed.

## Capabilities (role matrix)

| Capability | customer_admin | billing_viewer | technical_operator | read_only |
| --- | --- | --- | --- | --- |
| View all portal sections | yes | yes | yes | yes |
| Submit renewal / capacity / prepaid credit | yes | yes | no | no |
| Submit agent access | yes | no | yes | no |
| Submit license / deployment support | yes | no | yes | no |
| Submit general support | yes | yes | yes | no |
| Cancel submitted requests | yes (any) | own only | own only | no |
| Comment on requests | yes | yes | yes | no |

Cancellation additionally requires the actor to be the requester (or a
customer admin). The server is the authority; the UI only reflects
server-issued capabilities.

## API hardening

- Same-origin only: no CORS headers are emitted, so cross-origin browsers
  cannot read responses.
- Browser mutations require a same-host `Origin` header when one is present.
- Strict `Content-Type: application/json` check on bodies; body size limited
  to 64 KiB.
- Schema validation at the Worker boundary for every request payload.
- Safe error envelopes with stable codes and no stack traces.
- `Cache-Control: no-store` on all authenticated responses.
- `X-Robots-Tag: noindex, nofollow, noarchive` and the CSP security headers
  are set on every response.
- Machine clients are rate limited (in-memory sliding window, 120
  req/min/client per isolate) with `Retry-After` on 429s.

## Rate limiting integration point

The in-memory limiter (`worker/api/rate-limit.ts`) is per-isolate and
documented as such. Production should add Cloudflare WAF / rate limiting
rules keyed on the machine client token (or IP) in front of `/api/v1/*`, and
can raise the per-isolate limit accordingly. Sessions are additionally
protected by Cloudflare Access at the edge.

## Secrets

- No secrets in the frontend bundle: the SPA only talks to same-origin API
  endpoints and never receives tokens, hashes or signing material.
- `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ACCESS_CERTS_URL`,
  `OPERATOR_SERVICE_URL`, `LICENSE_SERVICE_URL`, `OPERATOR_SERVICE_TOKEN`,
  `LICENSE_SERVICE_TOKEN`, and `OPERATOR_CALLER_TOKEN` are secrets /
  local-only vars. `wrangler.jsonc` holds no secrets; `.dev.vars.example`
  holds placeholders only.
- Credentials for machine clients are stored hashed (SHA-256) with a
  non-secret display prefix.
- No raw credentials are ever logged; audit entries record actor emails or
  `machine:<clientName>` labels.

## Audit

`portal_audit_log` is append-only (no update/delete paths in the repository).
Every mutation writes an entry with the verified actor, target, correlation
id and metadata. Request events (`customer_request_events`) are append-only
by construction as well.