import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestApp,
  jsonBody,
  sessionRequest,
  machineRequest,
  serviceRequest,
  type TestApp,
} from './helpers/app';
import { randomIdempotencyKey } from './helpers/jwt';
import { generateCredential, createClient } from '../../worker/db/repos/api-clients';
import { getRequestDetail, listRequestEvents } from '../../worker/db/repos/requests';
import {
  applyOperatorDecision,
  getRequestForOperator,
  listRequestsForOperator,
} from '../../worker/db/repos/operator-requests';
import { OPERATOR_SERVICE_NAME } from '../../worker/auth/service-principal';

const OPERATOR_TOKEN = 'test-operator-caller-token';
const WRONG_TOKEN = 'definitely-not-the-operator-token';

let app: TestApp;
let adminJwt: string;
let machineCredential: string;

beforeAll(async () => {
  app = await createTestApp({ operatorCallerToken: OPERATOR_TOKEN });
  adminJwt = await app.sign({ email: 'dev.admin@acme.example' });
  machineCredential = await generateCredential();
  await createClient(app.harness.db, {
    customerId: 'acme-dev-001',
    name: 'Operator API Probe',
    credential: machineCredential,
    scopes: ['account:read', 'requests:read', 'requests:write'],
  });
});

afterAll(async () => {
  await app.close();
});

async function createSubmittedRequest(title = 'Operator test request'): Promise<string> {
  const response = await sessionRequest(app.app, app.env, adminJwt, '/api/v1/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'general_support',
      payload: { description: title },
      idempotencyKey: randomIdempotencyKey(),
    }),
  });
  expect(response.status).toBe(201);
  const body = await jsonBody(response);
  return (body as { request: { id: string } }).request.id;
}

function decisionBody(overrides: Record<string, unknown> = {}) {
  return {
    decision: 'approved',
    operatorNote: 'internal review note',
    customerVisibleMessage: 'Your request was approved.',
    idempotencyKey: randomIdempotencyKey(),
    ...overrides,
  };
}

describe('operator service authentication', () => {
  it('fails closed when OPERATOR_CALLER_TOKEN is missing', async () => {
    const broken = await createTestApp({ missingOperatorCallerToken: true });
    try {
      const response = await serviceRequest(broken.app, broken.env, OPERATOR_TOKEN, '/service/v1/requests');
      expect(response.status).toBe(503);
      const body = await jsonBody(response);
      expect(body.error).toBe('service_unavailable');
    } finally {
      await broken.close();
    }
  });

  it('rejects a missing Authorization header', async () => {
    const response = await serviceRequest(app.app, app.env, null, '/service/v1/requests');
    expect(response.status).toBe(401);
    expect((await jsonBody(response)).error).toBe('unauthorized');
  });

  it('rejects an incorrect token', async () => {
    const response = await serviceRequest(app.app, app.env, WRONG_TOKEN, '/service/v1/requests');
    expect(response.status).toBe(401);
    expect((await jsonBody(response)).error).toBe('unauthorized');
  });

  it('accepts a valid operator-console token', async () => {
    const response = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests');
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(body.apiVersion).toBe('1');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('rejects a customer JWT on service routes', async () => {
    const response = await sessionRequest(app.app, app.env, adminJwt, '/service/v1/requests');
    expect(response.status).toBe(401);
  });

  it('rejects a machine-client credential on service routes', async () => {
    const response = await machineRequest(app.app, app.env, machineCredential, '/service/v1/requests');
    expect(response.status).toBe(401);
  });

  it('ignores X-Service-Name and still requires the verified token', async () => {
    const forged = await serviceRequest(app.app, app.env, WRONG_TOKEN, '/service/v1/requests', {
      headers: { 'X-Service-Name': 'operator-console' },
    });
    expect(forged.status).toBe(401);
    const ok = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests', {
      headers: { 'X-Service-Name': 'not-the-authority' },
    });
    expect(ok.status).toBe(200);
  });
});

describe('operator request list and detail', () => {
  it('lists requests newest first with a versioned envelope', async () => {
    const response = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests?limit=50');
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    const items = body.items as Array<{ requestId: string; createdAt: string; customerId: string }>;
    expect(items.length).toBeGreaterThan(0);
    for (let i = 1; i < items.length; i++) {
      expect(`${items[i - 1].createdAt}|${items[i - 1].requestId}` >= `${items[i].createdAt}|${items[i].requestId}`).toBe(true);
    }
    expect(body.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ idempotency_key: expect.anything() })]));
  });

  it('filters by customerId, status, and requestType', async () => {
    const byCustomer = await jsonBody(
      await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests?customerId=acme-dev-001'),
    );
    const items = byCustomer.items as Array<{ customerId: string }>;
    expect(items.every((item) => item.customerId === 'acme-dev-001')).toBe(true);

    const byStatus = await jsonBody(
      await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests?status=submitted'),
    );
    expect((byStatus.items as Array<{ status: string }>).every((item) => item.status === 'submitted')).toBe(true);

        const byType = await jsonBody(
      await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests?requestType=license_renewal'),
    );
    expect((byType.items as Array<{ requestType: string }>).every((item) => item.requestType === 'license_renewal')).toBe(true);

    const byReview = await jsonBody(
      await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests?status=under_review'),
    );
    expect((byReview.items as Array<{ status: string }>).every((item) => item.status === 'under_review')).toBe(true);

    expect((await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests?requestType=renewal')).status).toBe(400);
    expect((await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests?status=in_review')).status).toBe(400);
  });

  it('rejects invalid query values and enforces limit bounds', async () => {
    expect((await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests?status=nope')).status).toBe(400);
    expect((await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests?requestType=refund')).status).toBe(400);
    expect((await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests?limit=0')).status).toBe(400);
    expect((await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests?limit=101')).status).toBe(400);
    expect((await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests?cursor=%%%')).status).toBe(400);
  });

  it('pages with a deterministic cursor', async () => {
    const first = await jsonBody(await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests?limit=1'));
    expect(typeof first.nextCursor === 'string' || first.nextCursor === null).toBe(true);
    if (typeof first.nextCursor === 'string') {
      const second = await jsonBody(
        await serviceRequest(app.app, app.env, OPERATOR_TOKEN, `/service/v1/requests?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`),
      );
      const firstId = (first.items as Array<{ requestId: string }>)[0].requestId;
      const secondId = (second.items as Array<{ requestId: string }>)[0]?.requestId;
      expect(secondId).not.toBe(firstId);
    }
  });

  it('returns request detail with a timeline', async () => {
    const response = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests/req-acme-submitted-001');
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    const request = body.request as { requestId: string; payload: unknown; events: unknown[]; requestType: string; status: string };
    expect(request.requestId).toBe('req-acme-submitted-001');
    expect(request.payload).toBeTruthy();
    expect(request.events.length).toBeGreaterThan(0);
    expect(request.requestType).toBe('plan_change');
    expect(request.status).toBe('submitted');
  });

  it('returns 404 for an unknown request', async () => {
    const response = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests/req-does-not-exist');
    expect(response.status).toBe(404);
    expect((await jsonBody(response)).error).toBe('request_not_found');
  });
});

describe('operator decisions', () => {
  it('records every decision type', async () => {
    const underReview = await createSubmittedRequest('under review');
    const approved = await createSubmittedRequest('approve me');
    const rejected = await createSubmittedRequest('reject me');
    const needsInfo = await createSubmittedRequest('need info');
    const completeSource = await createSubmittedRequest('complete me');

    expect(
      (
        await serviceRequest(app.app, app.env, OPERATOR_TOKEN, `/service/v1/requests/${underReview}/decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(decisionBody({ decision: 'under_review', operatorNote: 'queueing' })),
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await serviceRequest(app.app, app.env, OPERATOR_TOKEN, `/service/v1/requests/${approved}/decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(decisionBody({ decision: 'approved' })),
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await serviceRequest(app.app, app.env, OPERATOR_TOKEN, `/service/v1/requests/${rejected}/decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(decisionBody({ decision: 'rejected', customerVisibleMessage: 'Not at this time.' })),
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await serviceRequest(app.app, app.env, OPERATOR_TOKEN, `/service/v1/requests/${needsInfo}/decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(decisionBody({ decision: 'needs_information' })),
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await serviceRequest(app.app, app.env, OPERATOR_TOKEN, `/service/v1/requests/${completeSource}/decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(decisionBody({ decision: 'approved', idempotencyKey: randomIdempotencyKey() })),
        })
      ).status,
    ).toBe(200);
    const completed = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, `/service/v1/requests/${completeSource}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decisionBody({ decision: 'completed', externalReference: 'op-job-1' })),
    });
    expect(completed.status).toBe(200);
    const completedBody = await jsonBody(completed);
    expect((completedBody.request as { status: string }).status).toBe('completed');
  });

  it('rejects a malformed body', async () => {
    const id = await createSubmittedRequest('bad body');
    const missingKey = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, `/service/v1/requests/${id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' }),
    });
    expect(missingKey.status).toBe(400);
    const emptyKey = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, `/service/v1/requests/${id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved', idempotencyKey: '' }),
    });
    expect(emptyKey.status).toBe(400);
    const notJson = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, `/service/v1/requests/${id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(notJson.status).toBe(400);
  });

  it('rejects an invalid lifecycle transition', async () => {
    const id = await createSubmittedRequest('cannot complete yet');
    const response = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, `/service/v1/requests/${id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decisionBody({ decision: 'completed' })),
    });
    expect(response.status).toBe(409);
    expect((await jsonBody(response)).error).toBe('invalid_transition');
  });

  it('replays an identical idempotent decision', async () => {
    const id = await createSubmittedRequest('idempotent');
    const key = randomIdempotencyKey();
    const payload = decisionBody({ decision: 'approved', idempotencyKey: key, operatorNote: 'one' });
    const first = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, `/service/v1/requests/${id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const second = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, `/service/v1/requests/${id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const a = await jsonBody(first);
    const b = await jsonBody(second);
    expect((b as { replayed: boolean }).replayed).toBe(true);
    expect((b.request as { requestId: string }).requestId).toBe((a.request as { requestId: string }).requestId);
    const events = await listRequestEvents(app.harness.db, 'acme-dev-001', id);
    expect(events.filter((event) => event.eventType === 'status_changed').length).toBe(1);
  });

  it('conflicts when an idempotency key is reused with a different payload', async () => {
    const id = await createSubmittedRequest('conflict');
    const key = randomIdempotencyKey();
    const first = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, `/service/v1/requests/${id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decisionBody({ decision: 'approved', idempotencyKey: key })),
    });
    expect(first.status).toBe(200);
    const second = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, `/service/v1/requests/${id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decisionBody({ decision: 'rejected', idempotencyKey: key })),
    });
    expect(second.status).toBe(409);
    expect((await jsonBody(second)).error).toBe('idempotency_conflict');
  });

  it('returns 404 for a decision on an unknown request', async () => {
    const response = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, '/service/v1/requests/req-missing/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decisionBody()),
    });
    expect(response.status).toBe(404);
  });

  it('never persists the bearer token and keeps operator notes off the customer API', async () => {
    const id = await createSubmittedRequest('visibility');
    await serviceRequest(app.app, app.env, OPERATOR_TOKEN, `/service/v1/requests/${id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        decisionBody({
          decision: 'approved',
          operatorNote: 'do not show this internally labeled note',
          customerVisibleMessage: 'Approved for the customer.',
        }),
      ),
    });

    const leaked = await app.harness.db
      .prepare(
        `SELECT COUNT(*) AS n FROM customer_request_events WHERE message LIKE ?1 OR metadata_json LIKE ?1
         UNION ALL
         SELECT COUNT(*) AS n FROM portal_audit_log WHERE metadata_json LIKE ?1 OR actor_email LIKE ?1
         UNION ALL
         SELECT COUNT(*) AS n FROM idempotency_records WHERE response_body_json LIKE ?1`,
      )
      .bind(`%${OPERATOR_TOKEN}%`)
      .all<{ n: number }>();
    expect(leaked.results.every((row) => row.n === 0)).toBe(true);

    const customer = await getRequestDetail(app.harness.db, 'acme-dev-001', id);
    expect(customer?.events?.some((event) => JSON.stringify(event).includes('do not show this internally labeled note'))).toBe(false);
    expect(customer?.events?.some((event) => event.message === 'Approved for the customer.')).toBe(true);

    const operator = await getRequestForOperator(app.harness.db, id);
    expect(operator?.events.some((event) => event.operatorNote === 'do not show this internally labeled note')).toBe(true);
    expect(operator?.events.some((event) => event.principalType === 'service' && event.principalIdentifier === OPERATOR_SERVICE_NAME)).toBe(true);
  });
});

describe('operator membership provisioning', () => {
  const membershipPath = (customerId: string, email: string) =>
    `/service/v1/customers/${encodeURIComponent(customerId)}/memberships/${encodeURIComponent(email)}`;

  function membershipBody(overrides: Record<string, unknown> = {}) {
    return {
      displayName: 'Eval Admin',
      role: 'customer_admin',
      status: 'active',
      demoExpiresAt: '2026-10-14T00:00:00.000Z',
      correlationId: 'corr-mbr',
      idempotencyKey: randomIdempotencyKey(),
      ...overrides,
    };
  }

  it('rejects customer JWTs and machine credentials on the membership route', async () => {
    const path = membershipPath('demo_new', 'ada@acme.example');
    expect((await sessionRequest(app.app, app.env, adminJwt, path, { method: 'PUT', body: '{}' })).status).toBe(401);
    expect((await machineRequest(app.app, app.env, machineCredential, path, { method: 'PUT', body: '{}' })).status).toBe(401);
  });

  it('creates, replays, and reactivates a membership without leaking other tenants', async () => {
    const email = 'eval.admin@acme-eval.example';
    const path = membershipPath('acme-dev-001', email);
    const body = membershipBody({ idempotencyKey: 'membership-key-01' });
    const created = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(created.status).toBe(201);
    const createdJson = await jsonBody(created);
    expect(createdJson.membershipId).toBeTruthy();

    const replay = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(200);
    expect((await jsonBody(replay)).membershipId).toBe(createdJson.membershipId);

    const conflictKey = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, displayName: 'Other', idempotencyKey: 'membership-key-01' }),
    });
    expect(conflictKey.status).toBe(409);

    const otherCustomer = await serviceRequest(
      app.app,
      app.env,
      OPERATOR_TOKEN,
      membershipPath('globex-dev-002', email),
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(membershipBody({ idempotencyKey: 'membership-key-02' })) },
    );
    expect(otherCustomer.status).toBe(409);
    expect(JSON.stringify(await jsonBody(otherCustomer))).not.toMatch(/acme-dev-001/);
  });

  it('treats an expired demo membership as access_expired without tenant leakage', async () => {
    const email = 'expired.eval@acme.example';
    const created = await serviceRequest(app.app, app.env, OPERATOR_TOKEN, membershipPath('acme-dev-001', email), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(membershipBody({ demoExpiresAt: '2020-01-01T00:00:00.000Z', idempotencyKey: 'membership-exp-01' })),
    });
    expect([200, 201]).toContain(created.status);
    const token = await app.sign({ email });
    const response = await sessionRequest(app.app, app.env, token, '/api/v1/account/status');
    expect(response.status).toBe(403);
    const body = await jsonBody(response);
    expect(body.error).toBe('access_expired');
    expect(JSON.stringify(body)).not.toMatch(/acme-dev-001/);
  });
});

describe('operator repository behavior', () => {
  it('lists, filters, and bounds pages against D1', async () => {
    const page = await listRequestsForOperator(app.harness.db, { limit: 2 });
    expect(page.items.length).toBeLessThanOrEqual(2);
    const filtered = await listRequestsForOperator(app.harness.db, {
      customerId: 'acme-dev-001',
      status: 'cancelled',
      requestTypes: ['agent_access'],
      limit: 10,
    });
    expect(filtered.items.every((item) => item.status === 'cancelled' && item.requestType === 'additional_agent_access')).toBe(true);
  });

  it('appends events atomically and preserves history', async () => {
    const id = await createSubmittedRequest('history');
    const before = await listRequestEvents(app.harness.db, 'acme-dev-001', id);
    const result = await applyOperatorDecision(app.harness.db, {
      requestId: id,
      decision: 'under_review',
      operatorNote: 'start review',
      customerVisibleMessage: 'We are reviewing this.',
      idempotencyKey: randomIdempotencyKey(),
      principal: { principalType: 'service', serviceName: OPERATOR_SERVICE_NAME },
      correlationId: 'test-correlation',
    });
    expect(result.outcome).toBe('applied');
    const after = await listRequestEvents(app.harness.db, 'acme-dev-001', id);
    expect(after.length).toBe(before.length + 1);
    for (let i = 0; i < before.length; i++) {
      expect(after[i]).toEqual(before[i]);
    }
  });
});
