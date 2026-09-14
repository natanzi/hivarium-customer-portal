# PLAN 01 — Identity, tenancy and durable request foundation

Status: **implemented and committed** (`feat(portal): add identity and tenant-safe request foundation`).

## Scope

- Versioned D1 migrations for memberships, requests, events, audit log,
  machine clients and idempotency records.
- Cryptographic Cloudflare Access JWT verification with fail-closed
  configuration handling.
- Server-side role/capability matrix.
- Tenant-safe repositories (memberships, requests+events, audit, api clients,
  idempotency).
- Same-origin `/api/v1/*` boundary: account status, request list/create/
  detail/cancel/comment, error envelopes, Origin/Content-Type/body-size
  hardening, machine-client rate limiting.
- Deterministic local development seed data (fictional only, `.example`
  emails, local-only application).
- Miniflare-backed D1 integration tests plus unit tests for JWT and roles.

## Architecture decisions

1. **Auth shape**: session actors authenticate with the Cloudflare Access JWT
   header. Tests exercise the real cryptographic path with locally generated
   RSA keypairs and a static key provider. In local development
   (`ENVIRONMENT !== 'production'`) an identically-verified token may arrive
   via the `PORTAL_DEV_JWT` cookie so `wrangler dev` and Playwright can test
   the full UI without an Access edge. Production never accepts the cookie.
2. **Key fetching**: `CertKeyProvider` caches the team certs endpoint, honors
   `Cache-Control: max-age` (capped at 1 h), serves fresh stale cache on
   transient fetch errors, and force-refetches once on a kid miss.
3. **Idempotent creation**: `createRequest` writes the request, its initial
   `created` event, the audit entry and the idempotency record in one D1
   batch; `INSERT OR IGNORE` on the idempotency unique key makes concurrent
   duplicate submissions race-safe. Identical replay returns the original
   request (200); a different payload under the same key returns 409.
4. **Machine actors** are not memberships. `customer_requests.
   requested_by_membership_id` is a logical reference (`machine:<clientId>`
   for machine actors) without an FK so referential integrity is never
   violated; membership references are kept correct by construction.
5. **Fail closed**: missing `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` → 503
   `service_unavailable`; missing service binding → 503 `service_unavailable`;
   unreachable/not-implemented upstream → 503 `upstream_unavailable`.
6. **No existence leaks**: unknown member, disabled member, missing token and
   bad token all produce the identical 401 envelope; cross-tenant 404s are
   byte-identical to genuine not-found.

## Database schema (migrations 0001-0003)

See `migrations/0001_identity.sql`, `0002_requests.sql`, `0003_machine_api.sql`
and the fictional seed `scripts/seed-dev.sql`. The seed is outside
`migrations/` so `wrangler d1 migrations apply` can never pick it up; it is
applied only via `npm run db:seed:dev` (`--local`).

## Verification results (this plan)

- `npm run typecheck` — 0 errors
- `npm test` — 67 tests passed (worker unit + D1 integration)
- Migrations applied locally; second apply: "No migrations to apply!"
- `npm run build` — ok
- `npx wrangler deploy --dry-run` — ok
- `npm audit` — 0 vulnerabilities
- `git diff --check` — clean

## Gate notes

- Worker/D1 integration tests run through Miniflare with the real migration
  SQL against real SQLite; statements are collapsed to single lines because
  Miniflare's D1 `exec` rejects multi-line statements (test-harness detail
  only; `wrangler d1 migrations apply` handles the real files).
- `@cloudflare/workers-types` declares a global `Buffer: any`; test helpers
  import `Buffer` from `node:buffer` explicitly.