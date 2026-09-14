# Local development

Requires Node.js 22 (`.nvmrc`; `nvm use`).

```bash
npm install
npm run dev          # vite dev server (SPA only, no Worker API)
```

## Worker + API locally

```bash
npm run typecheck
npm test             # worker unit + D1 integration + component tests
npm run build        # typecheck + production bundle
npm run test:e2e     # build + Playwright (desktop, mobile, screenshots)
npx wrangler deploy --dry-run
```

Local D1 database:

```bash
npx wrangler d1 migrations apply PORTAL_DB --local   # apply schema
npm run db:seed:dev                                   # fictional seed (local only)
```

The seed (`scripts/seed-dev.sql`) lives outside `migrations/` so
`wrangler d1 migrations apply` can never apply it remotely. It contains only
fictional `.example` users and fixture requests.

To run the Worker with the full portal experience locally, copy
`.dev.vars.example` to `.dev.vars` and fill in your own throwaway values, or
mirror the E2E launch in `e2e/start-e2e.mjs` (certs server + service stubs +
`wrangler dev` with `--var` overrides). Local sessions authenticate with a
`PORTAL_DEV_JWT` cookie that the Worker accepts only when
`ENVIRONMENT !== 'production'`.

## E2E

`npm run test:e2e` rebuilds the bundle and starts:

1. `e2e/servers.mjs` — certs/JWT-signing + Operator/License contract stubs;
2. `wrangler dev --local` with test-only vars;
3. real Chromium at 1440×900 (desktop) and 390×844 (mobile).

Individual projects:

```bash
npx playwright test --project desktop
npx playwright test --project mobile
npx playwright test --project screenshots   # .artifacts/screenshots/*
```

## Verification gates (run after every plan)

1. `npm clean-install`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. `npx playwright test`
6. `npx wrangler d1 migrations apply PORTAL_DB --local` (twice — second run
   must report nothing to apply)
7. `npx wrangler deploy --dry-run`
8. `npm audit` (must stay at 0 vulnerabilities)
9. `git diff --check`
10. `git status --short`

Never run D1 commands against the remote database from this repository, and
never deploy or push without an explicit request.