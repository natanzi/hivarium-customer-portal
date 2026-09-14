# PLAN 02 — Customer portal read experience

Status: **implemented and committed** (`feat(portal): add customer account and entitlement views`).

## Scope

- Typed `OperatorService` / `LicenseService` ports with deterministic
  in-memory test adapters; every method fails closed.
- Read endpoints: `/api/v1/overview`, `/api/v1/subscription`, `/api/v1/agents`,
  `/api/v1/licenses`, `/api/v1/usage` (prepaid ledger vs commercial summary).
- Shared application shell: compact desktop sidebar, mobile drawer with
  accessible menu button, organization identity, authenticated-user control,
  real Access sign-out link, primary "New request" action.
- Pages: Overview, Subscription, Agents, Licenses & deployments, Usage,
  Account, plus Unauthorized and Service-unavailable states.
- Loading / error / empty / unavailable state surfaces; WCAG AA palette;
  reduced-motion support; stacked responsive tables; 36px+ controls.
- Component tests (jsdom + Testing Library).

## Design decisions

- **Session gate owns routing.** A single gate maps every session state to
  the correct route tree, so the app never stalls on a redirect hop and any
  entry URL converges to the right page. Public state pages always render.
- **No fabricated data.** Sections whose upstream service is missing render a
  labeled unavailable surface; the overview aggregates nulls instead of
  inventing counts.
- **Usage is model-aware.** Prepaid customers get a token ledger with filters
  and safe CSV export; other models get a commercial usage summary — the two
  states never blur.
- **Role-based actions** come from the server-issued capabilities, never from
  client state.

## Verification results (this plan)

- `npm run typecheck` — 0 errors
- `npm test` — 98 passed (68 worker + 30 components)
- `npm run build`, `npx wrangler deploy --dry-run` — ok
- `npm audit` — 0 vulnerabilities
- `git diff --check` — clean