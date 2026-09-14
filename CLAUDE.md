# Claude Code Instructions — Hivarium Customer Portal

`AGENTS.md` is the canonical repository instruction file. Read it completely before diagnosing, planning, or editing this project, and follow it even when a task prompt omits repository boundaries.

## Working contract

- Work only in `hivarium-customer-portal` unless the user explicitly authorizes coordinated changes in another repository.
- Preserve the current working tree and inspect existing code before adding abstractions.
- Treat `PORTAL_DB` as authoritative only for portal memberships, requests, request history, portal audit, and machine-client metadata.
- Treat Operator Console and License Service responses as upstream authority; never reproduce them as editable portal state.
- Keep customer operations request-based. Do not add checkout, payment, direct renewal, direct entitlement grants, balance mutation, or license issuance.
- Never bypass Cloudflare Access, tenant isolation, role checks, machine scopes, idempotency, or audit behavior.
- Never commit secrets, production identity tokens, raw API credentials, or real customer data.
- Prefer focused, reviewable changes with tests. Run the relevant gates listed in `AGENTS.md` before declaring completion.
- Do not push, deploy, migrate remote D1, or attach a production domain unless the user explicitly requests it.

When documentation and implementation disagree, verify behavior in code and tests, then update the documentation in the same change.

