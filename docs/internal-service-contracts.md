# Internal service contracts

This document is the authoritative contract between the Customer Portal and
the two internal Hivarium services it reads through. It is **expected** that
some endpoints below are not implemented yet; the portal fails closed for any
missing contract and renders the affected section as unavailable. The portal
never duplicates upstream authority locally as a workaround.

## Connectivity model

- The browser calls only same-origin `/api/v1/*` endpoints on the portal.
- The portal Worker calls the internal services server-to-server:
  - production: Cloudflare Service Bindings named `OPERATOR_SERVICE` and
    `LICENSE_SERVICE` (declared in `worker/index.ts` `PortalEnv`; commented
    out in `wrangler.jsonc` until the services are deployed);
  - local development / E2E: `OPERATOR_SERVICE_URL` / `LICENSE_SERVICE_URL`
    URL overrides (never set in production).
- If neither a binding nor a URL override exists, the port returns
  `missing_binding` and every dependent section returns
  `503 service_unavailable`.

## Error mapping

| Port result            | HTTP code | API error code        |
| ---------------------- | --------- | --------------------- |
| `missing_binding`      | 503       | `service_unavailable` |
| `not_implemented`      | 503       | `upstream_unavailable`|
| `unreachable` (net/5xx/401/403) | 503 | `upstream_unavailable` |

## Operator Console (authoritative for customers, commercial, balances, usage, agent grants)

Expected service: the Hivarium Operator Console Worker.

Current status: **partially implemented**. The portal maps the console's
existing endpoints below. The console authenticates its own API with
Cloudflare Access; the portal-to-console service authentication mechanism is
**not yet defined** — see "Missing integrations".

| Portal port method                  | Expected upstream endpoint                    | Status |
| ----------------------------------- | --------------------------------------------- | ------ |
| `getCustomerProfile(customerId)`    | `GET /api/customers/:customerId`             | implemented |
| `getCommercial(customerId)`         | `GET /api/customers/:customerId/commercial`  | implemented |
| `getAccess(customerId)`             | `GET /api/customers/:customerId/access`      | implemented |
| `getLedger(customerId)`             | `GET /api/customers/:customerId/ledger`      | implemented |
| `getUsageSummary(customerId)`       | `GET /api/customers/:customerId/usage-summary` | implemented |
| `getAgentCatalog()`                 | `GET /api/agents`                            | implemented |
| `getActivity(customerId)`           | `GET /api/customers/:customerId/activity`    | implemented |

### Expected response shapes (current contract)

`GET /api/customers/:id` → `{ id, name, status }`

`GET /api/customers/:id/commercial` → `{ customerId, asOf, active[], scheduled[], history[] }`
where each arrangement carries at least:
`id, model, status, effectiveDate/startsAt, endDate/endsAt, renewalDate,
seatCapacity/seats, agentCapacity, prepaidBalanceTokens/balanceTokens,
warningThresholdTokens, contractReference/reference, deploymentModel,
bareMetal/bareMetalModel, offlineAllowed`

`GET /api/customers/:id/access` → `{ customerId, asOf, current[], scheduled[], history[] }`
where each grant carries:
`grantId/id, agentProductId, agentName, category, version, status, startsAt,
endsAt, licenseId, deploymentId`

`GET /api/customers/:id/ledger` → `{ customerId, rows[], balanceTokens, netTokensConsumed }`
where each row carries:
`transactionId/id, occurredAt, kind (credit_grant|usage|adjustment|reversal),
amountTokens, runningBalanceTokens, reference, reason, agentProductId, agentName`

`GET /api/customers/:id/usage-summary` → `{ customerId, rows[], netTokensConsumed }`
where each row carries: `agentProductId, agentName, tokensConsumed, usageCount`

`GET /api/agents` → `{ products: [{ id, name, category, version, description }] }`

`GET /api/customers/:id/activity` → `{ events: [{ id, occurredAt, type, message, actor }] }`

The portal's validator (`worker/services/operator.ts`) tolerates the alias
fields above; wholly unexpected shapes are treated as `unreachable` and the
section shows unavailable.

## License Service (authoritative for signed licenses, entitlements, activations)

Expected service: the Hivarium License Service Worker.

Current status: **implemented** on the License Service customer-scoped
`/service/v1/customers/:customerId/licenses*` routes. Missing bindings still
fail closed.

| Portal port method     | Expected upstream endpoint                            | Status |
| ---------------------- | ----------------------------------------------------- | ------ |
| `getLicenses(customerId)` | `GET /service/v1/customers/:customerId/licenses` | implemented |
| `getLicense(customerId, licenseId)` | `GET /service/v1/customers/:customerId/licenses/:licenseId` | implemented |
| `downloadLicenseDocument(...)` | `GET /service/v1/customers/:customerId/licenses/:licenseId/document` | implemented |

### Expected response shape

`GET /service/v1/customers/:id/licenses` → `{ data: [...], meta }`
where each item carries:
`licenseId, customerId, productId, status, validFrom, validUntil,
deploymentType, limits`. The portal maps that envelope onto `{ customerId, licenses }`
for the UI (`id` ← `licenseId`, `product` ← `productId`, `issuedAt` ← `validFrom`,
`expiresAt` ← `validUntil`). Document responses are `{ jwsCompact }` with
`Content-Disposition: attachment`.

Security requirement: this endpoint must never expose signing secrets,
internal license payload secrets, operator notes, or data for other tenants.
The portal renders only the fields above.

## Missing integrations (blocked contracts)

1. **Portal → Operator Console service authentication.** The console's API is
   behind Cloudflare Access and validates `Cf-Access-Jwt-Assertion` for an
   operator email. Service-binding calls bypass the edge, so no JWT header is
   present. Until the console accepts a service credential (service token or
   shared secret header), production `OPERATOR_SERVICE` calls will be
   rejected and portal sections will show unavailable.
2. **Operator decisions → portal request status.** Implemented as
   `/service/v1/*` on this Worker (see `docs/operator-request-service.md`).
   The Operator Console authenticates with `Authorization: Bearer` matching
   `OPERATOR_CALLER_TOKEN` (`PORTAL_SERVICE_TOKEN` on the console). Customer
   JWTs and machine credentials cannot call these routes.
3. **License Service license read endpoint.** Implemented as
   `/service/v1/customers/:customerId/licenses*`. The portal authenticates with
   `LICENSE_SERVICE_TOKEN` (License Service `PORTAL_CALLER_TOKEN`).
4. **Machine credential issuance.** `api_clients` rows exist and the machine
   API authenticates against them, but no issuance endpoint exists in the
   portal (deliberate; see `docs/machine-api.md`). Operators create rows via
   direct database tooling only.

## How to add a contract

1. Extend the port interface (`worker/services/operator.ts` / `license.ts`).
2. Document the endpoint and response shape in this file.
3. Add the mapping to `docs/internal-service-contracts.md` status table.
4. Add a deterministic fixture to `worker/services/test-adapters.ts` and the
   E2E stub (`e2e/servers.mjs`) so tests prove the contract end to end.