/**
 * Local E2E support server (test-only, never deployed).
 *
 * Serves three things on one port:
 *  - GET /certs  : the JWKS for the E2E signing keypair, so the portal Worker
 *    can cryptographically verify tokens through its real code path;
 *  - GET /sign   : signs a Cloudflare-Access-shaped JWT for a given email
 *    (test harness minting; Playwright injects it as the PORTAL_DEV_JWT
 *    cookie, which the Worker accepts only when ENVIRONMENT !== 'production');
 *  - /operator/* and /license/*: deterministic stubs for the documented
 *    Operator Console and License Service contracts (see
 *    docs/internal-service-contracts.md).
 */

import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Buffer } from 'node:buffer';

const TEAM_DOMAIN = 'portal.test';
const AUDIENCE = 'portal-e2e-aud';
const KID = 'e2e-kid';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });

// ---------------------------------------------------------------------------
// Fictional fixture data (matches scripts/seed-dev.sql customers)
// ---------------------------------------------------------------------------

const CUSTOMER_ID = 'acme-dev-001';
const NOW = '2026-09-01T12:00:00.000Z';

const customerProfile = {
  id: CUSTOMER_ID,
  name: 'Acme Instruments (Dev Fixture)',
  status: 'active',
};

const commercial = {
  customerId: CUSTOMER_ID,
  asOf: NOW,
  active: [
    {
      id: 'arr-annual-2026',
      model: 'prepaid_tokens',
      status: 'active',
      effectiveDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-12-31T23:59:59.000Z',
      renewalDate: '2026-12-01T00:00:00.000Z',
      seatCapacity: 25,
      agentCapacity: 12,
      prepaidBalanceTokens: 4250,
      warningThresholdTokens: 1000,
      contractReference: 'HV-ACME-2026-001',
      deploymentModel: 'cloud',
      bareMetal: false,
      offlineAllowed: false,
    },
  ],
  scheduled: [],
  history: [],
};

const access = {
  customerId: CUSTOMER_ID,
  asOf: NOW,
  current: [
    {
      grantId: 'grant-scan-001',
      agentProductId: 'agent-scan-001',
      agentName: 'Threat Surface Scanner',
      category: 'security',
      version: '2.4.1',
      status: 'active',
      startsAt: '2026-03-01T00:00:00.000Z',
      endsAt: '2026-12-31T23:59:59.000Z',
      licenseId: 'lic-scan-2026',
      deploymentId: 'dep-prod-001',
    },
    {
      grantId: 'grant-relay-001',
      agentProductId: 'agent-relay-001',
      agentName: 'Signal Relay Agent',
      category: 'infrastructure',
      version: '1.9.0',
      status: 'active',
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: null,
      licenseId: null,
      deploymentId: 'dep-prod-002',
    },
  ],
  scheduled: [
    {
      grantId: 'grant-audit-001',
      agentProductId: 'agent-audit-001',
      agentName: 'Audit Trail Agent',
      category: 'compliance',
      version: '3.0.2',
      status: 'scheduled',
      startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: null,
      licenseId: null,
      deploymentId: null,
    },
  ],
  history: [],
};

const ledger = {
  customerId: CUSTOMER_ID,
  balanceTokens: 4250,
  netTokensConsumed: 750,
  rows: [
    { transactionId: 'tx-0006', occurredAt: '2026-08-28T09:15:00.000Z', kind: 'usage', amountTokens: -120, runningBalanceTokens: 4250, reference: 'agent-scan-001', reason: 'Scan batch 2026-08-28', agentProductId: 'agent-scan-001', agentName: 'Threat Surface Scanner' },
    { transactionId: 'tx-0005', occurredAt: '2026-08-14T11:00:00.000Z', kind: 'usage', amountTokens: -80, runningBalanceTokens: 4370, reference: 'agent-relay-001', reason: 'Relay batch', agentProductId: 'agent-relay-001', agentName: 'Signal Relay Agent' },
    { transactionId: 'tx-0004', occurredAt: '2026-07-20T14:00:00.000Z', kind: 'usage', amountTokens: -550, runningBalanceTokens: 4450, reference: 'agent-scan-001', reason: 'Corrected scan run', agentProductId: 'agent-scan-001', agentName: 'Threat Surface Scanner' },
    { transactionId: 'tx-0003', occurredAt: '2026-07-19T10:00:00.000Z', kind: 'reversal', amountTokens: 200, runningBalanceTokens: 5000, reference: 'tx-0002', reason: 'Operator reversal of duplicate charge', agentProductId: null, agentName: null },
    { transactionId: 'tx-0002', occurredAt: '2026-07-10T09:00:00.000Z', kind: 'usage', amountTokens: -200, runningBalanceTokens: 4800, reference: 'agent-scan-001', reason: 'Scan batch 2026-07-10', agentProductId: 'agent-scan-001', agentName: 'Threat Surface Scanner' },
    { transactionId: 'tx-0001', occurredAt: '2026-07-01T08:00:00.000Z', kind: 'credit_grant', amountTokens: 5000, runningBalanceTokens: 5000, reference: 'HV-ACME-2026-001', reason: 'Annual prepaid credit', agentProductId: null, agentName: null },
  ],
};

const usageSummary = {
  customerId: CUSTOMER_ID,
  netTokensConsumed: 750,
  rows: [
    { agentProductId: 'agent-scan-001', agentName: 'Threat Surface Scanner', tokensConsumed: 670, usageCount: 42 },
    { agentProductId: 'agent-relay-001', agentName: 'Signal Relay Agent', tokensConsumed: 80, usageCount: 12 },
  ],
};

const agentCatalog = {
  products: [
    { id: 'agent-scan-001', name: 'Threat Surface Scanner', category: 'security', version: '2.4.1', description: 'Continuous external and internal surface mapping.' },
    { id: 'agent-relay-001', name: 'Signal Relay Agent', category: 'infrastructure', version: '1.9.0', description: 'Reliable signal relay for offline environments.' },
    { id: 'agent-audit-001', name: 'Audit Trail Agent', category: 'compliance', version: '3.0.2', description: 'Append-only audit trail collection.' },
  ],
};

const activity = {
  events: [
    { id: 'act-001', occurredAt: '2026-08-28T09:15:00.000Z', type: 'ledger.usage', message: 'Token usage recorded for Threat Surface Scanner.', actor: 'Operator Console' },
    { id: 'act-002', occurredAt: '2026-08-01T08:00:00.000Z', type: 'ledger.credit_grant', message: 'Annual prepaid credit applied.', actor: 'Operator Console' },
  ],
};

const licenses = {
  customerId: CUSTOMER_ID,
  licenses: [
    {
      id: 'lic-scan-2026',
      licenseType: 'subscription',
      status: 'active',
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-12-31T23:59:59.000Z',
      permittedAgentProducts: ['agent-scan-001', 'agent-relay-001'],
      deployments: [
        { id: 'dep-prod-001', environment: 'production', mode: 'online', lastValidatedAt: '2026-08-30T06:00:00.000Z', heartbeatAt: '2026-08-30T06:00:00.000Z', activationCount: 1, activationLimit: 3 },
      ],
    },
    {
      id: 'lic-bare-2026',
      licenseType: 'bare_metal',
      status: 'active',
      issuedAt: '2026-02-01T00:00:00.000Z',
      expiresAt: '2027-01-31T23:59:59.000Z',
      permittedAgentProducts: ['agent-relay-001'],
      deployments: [
        { id: 'dep-bm-001', environment: 'bare_metal', mode: 'bare_metal', lastValidatedAt: '2026-08-29T22:00:00.000Z', heartbeatAt: null, activationCount: 1, activationLimit: 1 },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// JWT signing for test identities
// ---------------------------------------------------------------------------

function signToken(email) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: KID, typ: 'JWT' };
  const payload = {
    aud: AUDIENCE,
    iss: `https://${TEAM_DOMAIN}`,
    email,
    sub: email,
    exp: now + 3600,
    nbf: now - 30,
    iat: now,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput, 'utf8'), privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function json(response, payload, status = 200) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function operatorRoute(pathname, url, response) {
  const parts = pathname.split('/').filter(Boolean); // ["api","customers",id,resource,...]
  if (parts[1] !== 'customers') {
    json(response, { error: 'not_found' }, 404);
    return;
  }
  const customerId = parts[2];
  const resource = parts[3];
  if (customerId !== CUSTOMER_ID) {
    json(response, { error: 'not_found' }, 404);
    return;
  }
  if (resource === undefined) {
    json(response, customerProfile);
    return;
  }
  switch (resource) {
    case 'commercial':
      json(response, commercial);
      return;
    case 'access':
      json(response, access);
      return;
    case 'ledger':
      json(response, ledger);
      return;
    case 'usage-summary':
      json(response, usageSummary);
      return;
    case 'activity':
      json(response, activity);
      return;
    default:
      json(response, { error: 'not_found' }, 404);
  }
}

function licenseRoute(pathname, url, response) {
  if (pathname !== '/api/v1/licenses') {
    json(response, { error: 'not_found' }, 404);
    return;
  }
  const customerId = url.searchParams.get('customerId');
  if (customerId !== CUSTOMER_ID) {
    json(response, { error: 'not_found' }, 404);
    return;
  }
  json(response, licenses);
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const pathname = url.pathname;

  if (request.method === 'GET' && pathname === '/certs') {
    json(response, {
      keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }],
    });
    return;
  }
  if (request.method === 'GET' && pathname === '/sign') {
    const email = url.searchParams.get('email') ?? '';
    if (!email) {
      json(response, { error: 'email_required' }, 400);
      return;
    }
    json(response, { token: signToken(email) });
    return;
  }
  if (request.method === 'GET' && pathname.startsWith('/operator/')) {
    operatorRoute(pathname.replace(/^\/operator/, ''), url, response);
    return;
  }
  if (request.method === 'GET' && pathname.startsWith('/license/')) {
    licenseRoute(pathname.replace(/^\/license/, ''), url, response);
    return;
  }
  json(response, { error: 'not_found' }, 404);
});

const port = Number(process.env.E2E_SERVERS_PORT ?? 8789);
server.listen(port, '127.0.0.1', () => {
  console.log(`[e2e-servers] listening on http://127.0.0.1:${port}`);
});