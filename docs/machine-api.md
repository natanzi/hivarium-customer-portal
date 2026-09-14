# Machine-facing API (v1)

External agents and customer automation authenticate with `hv_`-prefixed
machine credentials, which are **separate** from Cloudflare Access browser
sessions. The API is same-origin `/api/v1/*` on the portal; credentials are
matched by SHA-256 hash and never stored in plaintext.

## Scope enforcement

Credentials carry `allowed_scopes` (JSON array). Scopes:

| Scope | Grants |
| --- | --- |
| `account:read` | `GET /api/v1/account/status` |
| `subscription:read` | `GET /api/v1/subscription` |
| `licenses:read` | `GET /api/v1/licenses` |
| `agents:read` | `GET /api/v1/agents` |
| `requests:read` | `GET /api/v1/requests` and request detail |
| `requests:write` | `POST /api/v1/requests` (idempotency key required) |

Unscoped calls return `403 forbidden`. Unknown or disabled/expired
credentials return the same `401 unauthorized` envelope as a missing token.

## Authentication

```
Authorization: Bearer hv_<64 hex chars>
```

Credentials have the shape `hv_` followed by 48 hex characters (24 random
bytes). Only `sha256(credential)` is stored in `api_clients.credential_hash`;
a display prefix (`hv_ab12…90ef`) is stored separately.

### Credential issuance is DISABLED in this MVP

There is no issuance endpoint. `api_clients` rows are created by operators
with direct database access (documented in `docs/internal-service-contracts.md`
as a missing integration). This is deliberate: no fake or half-secured
issuance flow ships. The hashing, verification, scope enforcement, rate
limiting and audit paths are fully implemented and tested, so enabling
issuance later is a bounded change.

## Mutations and idempotency

`POST /api/v1/requests` requires:

- `Idempotency-Key` header: 8–128 characters of `[A-Za-z0-9._-]`.
- `Content-Type: application/json` body: `{ requestType, title?, reason?,
  payload }`.

Behavior:

- First call with a key returns `201` with `{ request, replayed: false }`.
- Retry with the same key and identical payload returns `200` with
  `{ request, replayed: true }` and the same request id — safe for
  automation retries.
- Same key with a different payload returns `409 conflict`.
- Keys expire after 24 hours and are pruned.

Machine clients may **create** requests (renewal, capacity, support types)
but can never directly renew a contract, charge an account, change an
entitlement, mint a license or increase a balance. Those remain operator
decisions. External agents must validate signed licenses through the License
Service, not through this portal.

## Stable error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `unauthorized` | 401 | Missing/invalid token or credential |
| `forbidden` | 403 | Missing scope, or action not allowed for the role |
| `validation_error` | 400 | Body or header failed server validation |
| `conflict` | 409 | Idempotency key reused with a different payload |
| `unsupported_media_type` | 415 | Body is not `application/json` |
| `payload_too_large` | 413 | Body exceeds 64 KiB |
| `too_many_requests` | 429 | Per-client rate limit exceeded (`Retry-After` set) |
| `service_unavailable` | 503 | Portal/service configuration missing (fail closed) |
| `upstream_unavailable` | 503 | An internal service is unreachable or lacks the endpoint |
| `internal_error` | 500 | Unexpected failure (no internals in the body) |

Every response carries `x-request-id` for correlation with the audit log.

## Audit

Machine mutations write `portal_audit_log` entries with
`actor_email = machine:<clientName>` and metadata containing the client id.
Every request is rate limited per client id (in-memory, 120 req/min per
isolate; see `docs/security.md` for the edge integration point).

## Example

```http
POST /api/v1/requests
Authorization: Bearer hv_<credential>
Idempotency-Key: hv_agent_20260914_01
Content-Type: application/json

{ "requestType": "capacity_increase", "payload": { "capacityType": "agents", "desiredCapacity": 20 } }

→ 201 { "request": { "id": "req-...", "status": "submitted", ... }, "replayed": false }
```