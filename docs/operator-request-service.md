# Operator Console request service API

Inbound, versioned service contract for the Hivarium Operator Console. This is
not a customer-facing API. Browser sessions, machine-client credentials, and
portal administrator roles cannot call these endpoints.

## Authentication

| Item | Value |
| --- | --- |
| Portal secret | `OPERATOR_CALLER_TOKEN` (Cloudflare Worker secret) |
| Operator Console secret | `PORTAL_SERVICE_TOKEN` |
| Header | `Authorization: Bearer <token>` |
| Principal after verification | `{ principalType: "service", serviceName: "operator-console" }` |

Rules:

- The Operator Console `PORTAL_SERVICE_TOKEN` must equal the portal
  `OPERATOR_CALLER_TOKEN`.
- The token is compared with a SHA-256 digest in a constant-time loop.
- `X-Service-Name` and other caller-controlled identity headers are ignored.
- Missing `OPERATOR_CALLER_TOKEN` configuration fails closed with
  `503 service_unavailable`.
- Missing `Authorization` or an incorrect token returns `401 unauthorized`
  with the same envelope as other invalid credentials.
- The bearer token is never logged, returned, or stored in D1.
- Customer Access JWTs (`Cf-Access-Jwt-Assertion`) do not authorize
  `/service/v1/*`.
- Machine-client `hv_` credentials do not authorize `/service/v1/*`.
- Human portal administrators do not gain this principal by holding a
  `customer_admin` membership.

## Endpoints

Base path: `/service/v1`. Worker-first routing includes `/service/*`.

### `GET /service/v1/requests`

Query parameters (all optional; invalid values are `400 invalid_request`):

| Parameter | Rules |
| --- | --- |
| `customerId` | Non-empty, max 128 characters |
| `status` | Canonical portal status (see lifecycle) |
| `requestType` | Canonical portal request type |
| `cursor` | Opaque cursor from a previous `nextCursor` |
| `limit` | Integer 1–100; default 50 |

Ordering is `created_at DESC, id DESC`. The response is:

```json
{
  "apiVersion": "1",
  "items": [
    {
      "requestId": "req-…",
      "customerId": "…",
      "requestType": "renewal",
      "status": "submitted",
      "summary": "…",
      "submittedBy": { "displayName": "…", "email": "…" },
      "createdAt": "…",
      "updatedAt": "…"
    }
  ],
  "nextCursor": null
}
```

List items never include secrets, hashes, operator notes, or idempotency keys.

### `GET /service/v1/requests/:requestId`

Returns `{ apiVersion: "1", request }` with structured payload and an
immutable event timeline. Unknown ids return `404 request_not_found`.

Each event distinguishes:

- `customerVisibleMessage` — allowed in the customer portal
- `operatorNote` — Operator Console / service APIs only

### `POST /service/v1/requests/:requestId/decision`

```json
{
  "decision": "approved | rejected | needs_information | completed | under_review",
  "operatorNote": "optional internal note",
  "customerVisibleMessage": "optional customer-visible message",
  "externalReference": "optional downstream reference",
  "idempotencyKey": "required"
}
```

`under_review` is stored as canonical status `in_review`. `idempotencyKey` is
mandatory (`8–128` characters: letters, digits, `.`, `-`, `_`).

## Authorization matrix

| Caller | `/api/v1/*` | `/service/v1/*` |
| --- | --- | --- |
| Verified Cloudflare Access session | Tenant-scoped customer API | `401` |
| Machine client (`hv_` credential) | Scope-gated customer API | `401` |
| Operator Console bearer (`OPERATOR_CALLER_TOKEN`) | `401` (not a portal session) | Allowed |
| Missing/invalid operator token | n/a | `401` |
| Unconfigured `OPERATOR_CALLER_TOKEN` | n/a | `503` |

Customer APIs remain tenant-scoped: every read and mutation binds
`customer_id` from the verified membership. The operator service principal is
cross-tenant by design and is the only caller that may list or decide across
customers.

## Request types

The portal keeps its existing request types. Operator Console names map as:

| Operator Console name | Portal `requestType` |
| --- | --- |
| `license_renewal` | `renewal` |
| `plan_change` | `capacity_increase` |
| `additional_agent_access` | `agent_access` |
| `token_credit` | `prepaid_credit` |
| `support` | `general_support` (also `license_support`, `deployment_support`) |

This API does not accept payments or checkout.

## Lifecycle

Canonical stored names (do not use `under_review` as a stored status):

`submitted`, `in_review`, `needs_information`, `approved`, `rejected`,
`completed`, `cancelled`.

Operator transitions:

| From | To |
| --- | --- |
| `submitted` | `in_review`, `approved`, `rejected`, `needs_information` |
| `in_review` | `approved`, `rejected`, `needs_information` |
| `needs_information` | `in_review` |
| `approved` | `completed` |

`approved` means the operator accepted the request. `completed` means the
downstream operation finished. Customer submission never mutates commercial
arrangements, balances, agent access, or licenses.

Customer cancellation remains `submitted → cancelled` only, through the
existing customer-authorized cancel route. Operator decisions cannot cancel.

A customer comment on `needs_information` resubmits the request to
`in_review`.

Terminal: `rejected`, `completed`, `cancelled` — no further transitions.

## Idempotency

Decision keys are unique per `(customer_id, request.decision:<requestId>, key)`.

- Identical payload + key → original envelope with `replayed: true`
- Same key, different payload → `409 idempotency_conflict`
- Invalid transition → `409 invalid_transition` (not claimed as success)

The event stores a SHA-256 hash of the key, never the bearer token.

## Note visibility

| Field | Customer `/api/v1/*` | Operator `/service/v1/*` |
| --- | --- | --- |
| `customerVisibleMessage` / event `message` | Yes | Yes |
| `operatorNote` | Never | Yes |

Visibility is explicit in event metadata. Existing historical events are not
rewritten.

## Error codes

| HTTP | Code | When |
| --- | --- | --- |
| 400 | `invalid_request` | Bad query/body (malformed JSON on POST may surface as `validation_error`) |
| 401 | `unauthorized` | Missing or incorrect operator token |
| 404 | `request_not_found` | Unknown request id |
| 409 | `invalid_transition` | Illegal lifecycle change |
| 409 | `idempotency_conflict` | Key reused with a different payload |
| 503 | `service_unavailable` | Missing `OPERATOR_CALLER_TOKEN` |
| 500 | `internal_error` | Unexpected failure |

Envelopes never include SQL, stack traces, tokens, or other customers' rows.

## Operator Console integration

1. Store `PORTAL_SERVICE_TOKEN` in the Operator Console.
2. Store the same value as portal secret `OPERATOR_CALLER_TOKEN`.
3. Call `GET /service/v1/requests` to populate the operator queue.
4. Call `GET /service/v1/requests/:id` for the timeline.
5. Call `POST /service/v1/requests/:id/decision` with a stable idempotency key
   after an operator action. Downstream commercial/license work stays in the
   Operator Console / License Service; this API only records workflow state.

## Placeholder environment variables

See `.dev.vars.example`. Production uses Cloudflare secrets, not `wrangler.jsonc`.

```
# OPERATOR_CALLER_TOKEN="placeholder"
# OPERATOR_SERVICE_TOKEN="placeholder"
```

Never commit real tokens, Access JWTs, or customer credentials.
