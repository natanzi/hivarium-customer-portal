# Hivarium Customer Portal

Private customer workspace for viewing Hivarium subscriptions, usage, agent access,
license and deployment status, and for submitting service requests.

## Current scope

This repository is an intentionally small foundation. It contains a React/TypeScript
shell, a Cloudflare Worker API boundary, and a dedicated D1 binding. It does not yet
contain real customer data, authentication, checkout, payments, or production workflows.

## System boundaries

- **Customer Portal** owns customer identity-to-tenant membership and customer-originated requests.
- **Operator Console** remains authoritative for customer commercial arrangements, accounting, access grants, and operator decisions.
- **License Service** remains authoritative for signed license documents, activations, expirations, and revocations.
- The browser must use same-origin `/api/*` endpoints. Internal services are connected server-to-server with Cloudflare Service Bindings; credentials never ship to the browser.
- The portal must not duplicate authoritative balances, entitlements, or license state in its own D1 database.

The intended production hostname is `portal.hivarium.dev`. Until authentication and
tenant isolation are implemented and verified, the site must remain private and carry
`noindex, nofollow` directives.

## Local development

Use Node.js 22 or newer.

```bash
npm install
npm run dev
```

Validation:

```bash
npm run typecheck
npm test
npm run build
npx wrangler deploy --dry-run
```

Copy `.dev.vars.example` to `.dev.vars` only for local values. Never commit secrets.

## Deployment

Cloudflare resources are declared in `wrangler.jsonc`. The production D1 database is
bound as `PORTAL_DB`. Automated builds should run `npm run build && npm test` before
`npx wrangler deploy`.
