# Hivarium Customer Portal — MVP Specification

Status: implemented in three plans (see `PLAN-01`, `PLAN-02`, `PLAN-03` under `planning/`).

## Product purpose

The Customer Portal is the customer-facing companion to Hivarium. An
authenticated customer can understand their current commercial relationship,
view subscription/contract status, prepaid token balance and usage, see which
Hivarium agents they can access, inspect license and deployment status, and
submit renewal, capacity, support and agent-access requests, following their
status and history.

There are no online sales or payment workflows. All changes remain
approval-based: customers submit requests; authorized Hivarium operators
decide and execute them through the Operator Console.

## System boundaries

| Domain | Owner |
| --- | --- |
| Portal users, membership-to-customer mappings, portal roles, customer-originated requests, request events, portal audit log, machine-client registrations | **Customer Portal** |
| Customer records, commercial arrangements, prepaid balances and usage ledger, agent-access grants, operator approvals and decisions, accounting state | **Operator Console** |
| Signed licenses, entitlements, activations, expiration/revocation, machine-readable verification | **License Service** |

The portal never copies authoritative balances, contract state, entitlements
or license status into its own D1 tables as editable truth. It reads them
through typed service ports that fail closed, and renders an explicit
"unavailable" state when an upstream contract is missing.

## Security model

- Everything is behind Cloudflare Access. The Worker additionally verifies
  the `Cf-Access-Jwt-Assertion` token cryptographically (RS256, issuer and
  audience checks, key rotation via the team certs endpoint) and fails closed
  when `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is missing.
- The active customer id and role are derived exclusively server-side from
  `PORTAL_DB`. Client-submitted email, customer id, role and tenant id are
  never trusted.
- Cross-tenant reads and mutations are structurally impossible: every
  repository call is bound to the verified `customer_id`, and cross-tenant
  lookups return the same envelope as not-found.
- Browser mutations require a same-host Origin. Machine clients use hashed
  credentials with scope enforcement, separate from Cloudflare Access
  sessions.
- No raw credentials are stored. No internal stack traces are returned.
  `noindex, nofollow, noarchive` and the CSP/security headers are retained.

## Implementation plans

1. `planning/PLAN-01-identity-and-requests.md` — identity, tenancy and the
   durable request foundation (committed as `feat(portal): add identity and
   tenant-safe request foundation`).
2. `planning/PLAN-02-customer-read-experience.md` — the read experience
   (committed as `feat(portal): add customer account and entitlement views`).
3. `planning/PLAN-03-requests-and-machine-api.md` — requests UX and the
   machine API boundary (committed as `feat(portal): add service requests and
   machine API boundary`).