# PLAN 03 — Requests and machine integration boundary

Status: **implemented and committed** (`feat(portal): add service requests and machine API boundary`).

## Scope

- Requests workspace: list with status filters and pagination, per-type
  creation form (client + server validation, idempotent submission), detail
  page with append-only history, cancellation rules and comments.
- Machine-facing API: hashed credentials, scope enforcement, mandatory
  idempotency keys, per-client rate limiting, audit records.
- Playwright E2E suite (desktop + mobile) and screenshot captures.
- Documentation: internal service contracts, security model, machine API,
  architecture, local development.

## Key decisions

1. **E2E without Cloudflare Access.** A local certs+signing server issues
   real RS256 JWTs; the Worker verifies them through its production code
   path (`ACCESS_CERTS_URL` override + `PORTAL_DEV_JWT` cookie in
   non-production only). The stub services serve the exact contract shapes
   documented in `docs/internal-service-contracts.md`, so the E2E suite
   exercises the real fetch-based ports end to end.
2. **Cancellation rights.** A customer admin (or the original requester) may
   cancel only while `submitted`. The server decides; the UI mirrors the
   server-issued capabilities.
3. **Credential issuance stays disabled.** Hashing, lookup, scopes, rate
   limiting and audit are fully implemented and tested; there is no issuance
   endpoint yet (documented in `docs/machine-api.md` and
   `docs/internal-service-contracts.md`).
4. **Found in E2E (real bugs fixed):**
   - workerd rejects unbound-global `fetch` invoked through an instance
     property ("Illegal invocation") — the certs provider now calls fetch via
     an arrow closure;
   - `--var` overrides work, but certs fetch was silently failing before the
     fix, so auth tests could not pass locally;
   - D1's `exec` in Miniflare is line-based — test harness collapses
     statements (already handled in PLAN 01 tooling);
   - a strictly-mobile nav flow had to open the drawer first (correct mobile
     behavior, now asserted).

## Verification results (this plan)

- `npm run typecheck` — 0 errors
- `npm test` — 109 passed (68 worker + 41 components)
- Playwright — 46 passed, 2 skipped by design (desktop-only / mobile-only
  flows): desktop 17, mobile 17, screenshots 12
- Screenshots — 12 captures in `.artifacts/screenshots/` (gitignored)
- `npm run build`, `wrangler deploy --dry-run`, `npm audit` — ok
- `git diff --check` — clean