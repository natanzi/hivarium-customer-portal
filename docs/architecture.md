# Architecture

## System

```
                    ┌──────────────────────────────┐
 Browser (React SPA)│  Cloudflare Access (edge)   │
 same-origin /api/v1│  portal.hivarium.dev         │
                    └──────────────┬───────────────┘
                                   │ Cf-Access-Jwt-Assertion
                    ┌──────────────▼───────────────┐
                    │  Customer Portal Worker      │
                    │  - JWT verification (fail    │
                    │    closed)                   │
                    │  - tenancy (PORTAL_DB D1)    │
                    │  - /api/v1/* boundary        │
                    │  - typed service ports       │
                    └───────┬──────────────┬───────┘
              Service Bindings (or local URL overrides)
          ┌─────────────────┴───┐    ┌────┴──────────────────┐
          │ OPERATOR_SERVICE    │    │ LICENSE_SERVICE       │
          │ Operator Console    │    │ License Service       │
          └─────────────────────┘    └───────────────────────┘
```

## What the portal owns (authoritative in PORTAL_DB)

- `portal_memberships` — users mapped to customers with portal roles.
- `customer_requests` + `customer_request_events` — customer-originated
  requests and their append-only history.
- `portal_audit_log` — append-only security/mutation audit.
- `api_clients` — machine credentials (hashed) and scopes.
- `idempotency_records` — safe retries for request creation.

Everything else (customers, commercial arrangements, balances, usage ledger,
agent grants, licenses, entitlements, approvals) is read through the typed
ports and never duplicated as editable truth.

## Request lifecycle

1. Customer submits a request (browser form or machine client).
2. The Worker validates payload, role, idempotency key, then in one
   transaction-ish flow claims the idempotency slot and atomically writes
   request + initial `created` event + audit entry.
3. The customer can cancel while `submitted`, or add comments.
4. Operator decisions change status through the Operator Console. The
   inbound status-sync contract is documented but not yet implemented
   (`docs/internal-service-contracts.md`), so operator-driven statuses are
   visible only when that integration lands.

## Directory map

| Path | Purpose |
| --- | --- |
| `worker/index.ts` | Worker entry: routing, middleware, security headers |
| `worker/auth/` | JWT verification, identity resolution, role matrix |
| `worker/db/repos/` | Tenant-safe D1 repositories |
| `worker/services/` | Operator/License ports, fetch implementations, test adapters |
| `worker/api/` | Error envelope, validation, rate limiting, v1 handlers |
| `shared/types.ts` | API contract types shared by Worker and SPA |
| `src/` | React SPA (shell, pages, session guard, styles) |
| `migrations/` | Versioned D1 migrations (applied with `wrangler d1`) |
| `scripts/seed-dev.sql` | Fictional local seed (never picked up by migrations) |
| `tests/worker/` | Vitest worker unit + D1 integration tests (Miniflare) |
| `tests/components/` | Vitest + Testing Library component tests |
| `e2e/` | Playwright suite + local support servers + launcher |
| `docs/` | Contracts, security, machine API, this document |
| `planning/` | Spec and per-plan documentation |

## Testing strategy

- Worker tests run the real fetch handler with real RS256 JWTs and real D1
  (Miniflare + migration SQL).
- Component tests mock fetch deterministically and cover states, roles and
  accessibility behaviors.
- Playwright E2E boots the whole stack locally: certs/stub servers + `wrangler
  dev` with a seeded fictional tenant, and drives real Chromium at desktop
  and mobile viewports. Screenshots land in `.artifacts/` (gitignored).
- No test uses conditional skips to hide failures; project-specific flows
  (desktop vs mobile) are skipped by design, and everything else must pass.