# Hivarium Customer Portal — Agent Instructions

## Purpose

This repository contains the private, customer-facing Hivarium portal. It gives an authenticated customer a tenant-scoped view of its commercial relationship, prepaid usage, agent access, license and deployment status, and customer-originated service requests.

This is not the public marketing site, the internal Operator Console, the license-signing authority, a payment checkout, or a general-purpose CRM.

## Repository ownership

This service owns:

- Cloudflare Access identity-to-customer membership mappings;
- portal roles and capabilities;
- customer-originated requests, comments, and append-only request events;
- portal audit records;
- machine-client registrations, hashed credentials, scopes, and idempotency records;
- the responsive customer portal UI and its same-origin API.

This service does not own:

- customer master records, commercial arrangements, balances, usage ledgers, or agent grants — these belong to `hivarium-operator-console`;
- signed license documents, signing keys, activations, expiration, or revocation — these belong to `hivarium-license-service`;
- pricing, checkout, payments, invoicing, or automatic renewal.

Customer actions are approval-based requests. Never turn a portal request directly into an authoritative commercial, entitlement, balance, or license mutation.

## Architecture

- React 19, TypeScript, React Router, and Vite implement the SPA under `src/`.
- The Cloudflare Worker entry point is `worker/index.ts`.
- `PORTAL_DB` is the portal-owned D1 database.
- Versioned migrations are under `migrations/`.
- Shared API/domain shapes are under `shared/`.
- The browser calls only same-origin `/api/v1/*` routes.
- The Worker derives the customer and role from a verified identity; never trust client-supplied tenant, email, or role values.
- Typed upstream adapters live under `worker/services/`.
- Production integration uses Cloudflare Service Bindings named `OPERATOR_SERVICE` and `LICENSE_SERVICE`.
- Missing upstream bindings or incompatible response shapes must fail closed and produce an explicit unavailable state.

See `docs/architecture.md`, `docs/internal-service-contracts.md`, `docs/security.md`, and `docs/machine-api.md` before changing an integration boundary.

## Security invariants

- Verify Cloudflare Access JWT signature, issuer, audience, expiration, and key ID before resolving a membership.
- Missing authentication configuration fails closed.
- Unknown and disabled memberships must not reveal whether an email or customer exists.
- Enforce tenant isolation on every read and mutation in the Worker, not only in the UI.
- Browser mutations require same-origin checks and JSON validation.
- Machine clients use independent hashed credentials and explicit scopes; never reuse browser session identity.
- Do not store raw machine credentials.
- Mutations must be idempotent and auditable.
- Keep `Cache-Control: no-store`, CSP, clickjacking protection, and `noindex, nofollow, noarchive` behavior.
- Never commit `.dev.vars`, secrets, production JWTs, customer data, or credentials.

## Product and UX rules

- Preserve Hivarium's warm white/silver paper visual system, deep green typography, restrained burnt-orange accent, and calm enterprise hierarchy.
- Prefer meaningful operational information over generic dashboard cards or decorative charts.
- Keep desktop and 390 px mobile layouts usable.
- Use semantic landmarks, headings, buttons, links, labels, visible focus, and non-color status cues.
- Preserve loading, empty, unauthorized, unavailable, and error states.
- Sign out through `/cdn-cgi/access/logout`.
- Do not add online sales or payment flows unless the product owner explicitly starts a separate approved phase.

## Development workflow

Before changing files:

1. Read this file and the directly relevant documentation.
2. Run `git status --short` and preserve unrelated work.
3. Inspect the existing implementation and tests; do not invent duplicate abstractions.
4. For planned work, follow `planning/` artifacts and update them only when the task requests it.

Primary commands:

```bash
npm clean-install
npm run typecheck
npm test
npm run build
npm run test:e2e
npx wrangler deploy --dry-run
npm audit
git diff --check
```

Run Worker and component subsets with `npm run test:worker` and `npm run test:components` when useful. Seed only local D1 with `npm run db:seed:dev`. Never apply remote migrations, deploy, push, or configure `portal.hivarium.dev` without explicit authorization.

## Change discipline

- Keep migrations forward-only; never rewrite an applied migration.
- Keep fictional seed data outside production migrations.
- Keep upstream contracts typed and documented.
- Do not replace a failed upstream integration with locally fabricated authoritative data.
- Do not weaken authorization to make a UI or test pass.
- Do not hide failures with conditional skips.
- Update tests and integration documentation whenever a contract changes.
- End work by reporting exact files, commands, results, deviations, `git diff --check`, and `git status --short`.

