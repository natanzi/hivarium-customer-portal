# Hivarium Customer Portal

Private customer workspace for viewing Hivarium subscriptions, usage, agent
access, license and deployment status, and for submitting service requests.

## Current scope

A production-quality MVP behind Cloudflare Access: cryptographic session
authentication, server-side tenant isolation, customer-originated requests
with append-only history, a machine-facing API, and a responsive enterprise
UI. There are no online sales, checkout, pricing, invoicing or automatic
billing workflows — every change is approval-based and executed by Hivarium
operators through the Operator Console.

## System boundaries

- **Customer Portal** owns customer identity-to-tenant membership, portal
  roles, customer-originated requests, request events, portal audit records
  and machine-client credentials.
- **Operator Console** remains authoritative for customer records, commercial
  arrangements, prepaid balances and usage ledgers, agent-access grants and
  operator decisions.
- **License Service** remains authoritative for signed licenses,
  entitlements, activations, expirations and revocations.
- The browser only calls same-origin `/api/v1/*` endpoints. Internal services
  are connected server-to-server (Service Bindings `OPERATOR_SERVICE` /
  `LICENSE_SERVICE`); the portal never duplicates upstream authority as
  editable truth. Missing integrations fail closed and render unavailable
  states — see `docs/internal-service-contracts.md`.

## Documentation

- `docs/architecture.md` — system overview and directory map
- `docs/internal-service-contracts.md` — Operator/License contracts and missing integrations
- `docs/security.md` — authentication, tenancy, capabilities, hardening
- `docs/machine-api.md` — machine client API, scopes, idempotency
- `docs/local-development.md` — running, testing, verification gates
- `planning/` — spec and per-plan notes

## Quick start

Node.js 22 (`.nvmrc`):

```bash
npm install
npm run typecheck
npm test
npm run build
npm run test:e2e          # Playwright: desktop + mobile + screenshots
npx wrangler deploy --dry-run
```

Copy `.dev.vars.example` to `.dev.vars` only for local values. Never commit
secrets.

## Deployment notes

- Cloudflare resources are declared in `wrangler.jsonc`; the production D1
  database is bound as `PORTAL_DB`. Service bindings for the Operator Console
  and License Service are documented there and in the contracts doc; they are
  commented out until the services are ready.
- The intended production hostname is `portal.hivarium.dev`. Until the
  operator/license integrations and an Access policy for that hostname are
  in place, the portal must remain private and carry `noindex, nofollow`.
- Migrations: `npx wrangler d1 migrations apply PORTAL_DB` (never run from
  this repository without an explicit request).