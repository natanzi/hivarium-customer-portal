import { expect, test } from '@playwright/test';
import { EMAILS, MACHINE_CREDENTIAL, signIn, trackConsole } from './helpers';

test.describe('portal smoke and navigation', () => {
  test('authenticated customer reaches the overview', async ({ context, page }) => {
    const assertClean = trackConsole(page);
    await signIn(context, EMAILS.admin);
    await page.goto('/overview');
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Organization' })).toContainText('Acme Instruments (Dev Fixture)');
    await expect(page.getByRole('region', { name: 'Organization' })).toContainText('Prepaid tokens');
    assertClean();
  });

  test('root redirect completes and never stalls on a redirect message', async ({ context, page }) => {
    const assertClean = trackConsole(page);
    await signIn(context, EMAILS.admin);
    await page.goto('/');
    await expect(page).toHaveURL(/\/overview$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await expect(page.getByText('Redirecting')).toHaveCount(0);
    assertClean();
  });

  test('overview to agents navigation', async ({ context, page }, testInfo) => {
    await signIn(context, EMAILS.admin);
    await page.goto('/overview');
    if (testInfo.project.name === 'mobile') {
      await page.getByRole('button', { name: 'Open navigation menu' }).click();
      await page.getByRole('dialog', { name: 'Navigation menu' }).getByRole('link', { name: 'Agents', exact: true }).click();
    } else {
      await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Agents', exact: true }).click();
    }
    await expect(page).toHaveURL(/\/agents$/);
    await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
  });

  test('customer cannot see another tenant', async ({ context, page }) => {
    await signIn(context, EMAILS.globex);
    await page.goto('/requests');
    await expect(page.getByRole('heading', { name: 'Requests' })).toBeVisible();
    const response = await page.request.get('/api/v1/requests/req-acme-submitted-001');
    expect(response.status()).toBe(404);
    const missing = await page.request.get('/api/v1/requests/req-does-not-exist');
    expect((await missing.json()).error).toBe((await response.json()).error);
    await expect(page.getByText('No requests match the current filter.')).toBeVisible();
  });
});

test.describe('entitlement views', () => {
  test('agent access display', async ({ context, page }) => {
    await signIn(context, EMAILS.admin);
    await page.goto('/agents');
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Threat Surface Scanner' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Signal Relay Agent' })).toBeVisible();
    await expect(page.getByText('Audit Trail Agent')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Request additional agent access' }).first()).toBeVisible();
  });

  test('license and deployment display', async ({ context, page }) => {
    await signIn(context, EMAILS.admin);
    await page.goto('/licenses');
    await expect(page.getByRole('heading', { name: 'Licenses', exact: true })).toBeVisible();
    await expect(page.getByText('lic-scan-2026').first()).toBeVisible();
    await expect(page.getByText('dep-prod-001')).toBeVisible();
    await expect(page.getByText('1 / 3')).toBeVisible();
    await expect(page.getByText('Online').first()).toBeVisible();
  });

  test('prepaid usage display', async ({ context, page }) => {
    await signIn(context, EMAILS.admin);
    await page.goto('/usage');
    await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible();
    await expect(page.getByText('Current balance')).toBeVisible();
    await expect(page.getByText('4,250 tokens').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
    await expect(page.getByText('Ledger statement')).toBeVisible();
  });
});

test.describe('requests workflow', () => {
  test('create a request and reload preserves it', async ({ context, page }) => {
    const assertClean = trackConsole(page);
    await signIn(context, EMAILS.admin);
    await page.goto('/requests/new');
    await page.getByLabel('Request type').selectOption('capacity_increase');
    await page.getByLabel(/Requested plan or requirements/).fill('Increase demo capacity for Q4.');
    await page.getByLabel('Note').fill('E2E batch run.');
    await page.getByRole('button', { name: 'Submit request' }).click();
    await expect(page).toHaveURL(/\/requests\/req-/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Plan change' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel request' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Plan change' })).toBeVisible();
    await expect(page.getByText('E2E batch run.').first()).toBeVisible();
    assertClean();
  });

  test('cancel a submitted request and the state is protected afterwards', async ({ context, page }) => {
    await signIn(context, EMAILS.admin);
    await page.goto('/requests/new');
    await page.getByLabel('Request type').selectOption('general_support');
    await page.getByLabel('Subject').fill('Please cancel me');
    await page.getByLabel('Description').fill('Please cancel me after creation.');
    await page.getByRole('button', { name: 'Submit request' }).click();
    await expect(page).toHaveURL(/\/requests\/req-/, { timeout: 10_000 });

    await page.getByRole('button', { name: 'Cancel request' }).click();
    await expect(page.getByRole('dialog', { name: 'Cancel this request?' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel request' }).click();
    await expect(page.getByText(/Request cancelled/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);
  });

  test('non-cancellable state remains protected', async ({ context, page }) => {
    await signIn(context, EMAILS.admin);
    await page.goto('/requests/req-acme-approved-001');
    await expect(page.getByRole('heading', { name: 'Renewal request' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);
    const response = await page.request.post('/api/v1/requests/req-acme-approved-001/cancel');
    expect(response.status()).toBe(409);
  });

  test('role-restricted mutation is rejected', async ({ context, page }) => {
    await signIn(context, EMAILS.readonly);
    await page.goto('/requests/new');
    await expect(page.getByText('Not allowed')).toBeVisible();
    const response = await page.request.post('/api/v1/requests', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        requestType: 'general_support',
        payload: { description: 'attempt' },
        idempotencyKey: 'e2e-readonly-attempt-00001',
      },
    });
    expect(response.status()).toBe(403);
  });

  test('billing_viewer cannot submit agent-access requests', async ({ context, page }) => {
    await signIn(context, EMAILS.billing);
    await page.goto('/overview');
    const response = await page.request.post('/api/v1/requests', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        requestType: 'agent_access',
        payload: { agentProductId: 'agent-scan-001' },
        idempotencyKey: 'e2e-billing-agent-00001',
      },
    });
    expect(response.status()).toBe(403);
  });

  test('machine client can read state and submit idempotently, scoped', async ({ context, page, browser }) => {
    await signIn(context, EMAILS.admin);
    await page.goto('/overview');
    const headers = { Authorization: `Bearer ${MACHINE_CREDENTIAL}` };

    const status = await page.request.get('/api/v1/account/status', { headers });
    expect(status.status()).toBe(200);
    const statusBody = (await status.json()) as { auth: string; scopes: string[] };
    expect(statusBody.auth).toBe('machine');
    expect(statusBody.scopes).toContain('requests:write');

    const subscription = await page.request.get('/api/v1/subscription', { headers });
    expect(subscription.status()).toBe(200);

    const key = `e2e-machine-${Date.now()}`;
    const create = await page.request.post('/api/v1/requests', {
      headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      data: { requestType: 'capacity_increase', payload: { desiredCapacity: 12 } },
    });
    expect(create.status()).toBe(201);
    const createdBody = (await create.json()) as { request: { id: string } };
    const replay = await page.request.post('/api/v1/requests', {
      headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      data: { requestType: 'capacity_increase', payload: { desiredCapacity: 12 } },
    });
    expect(replay.status()).toBe(200);
    expect(((await replay.json()) as { request: { id: string } }).request.id).toBe(createdBody.request.id);

    const conflict = await page.request.post('/api/v1/requests', {
      headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      data: { requestType: 'capacity_increase', payload: { desiredCapacity: 99 } },
    });
    expect(conflict.status()).toBe(409);

    // A fresh, cookie-less context must be rejected.
    const anonymousContext = await browser.newContext();
    try {
      const anonymous = await anonymousContext.request.get('http://127.0.0.1:8788/api/v1/account/status');
      expect(anonymous.status()).toBe(401);
    } finally {
      await anonymousContext.close();
    }
  });
});

test.describe('state pages and mobile smoke', () => {
  test('error and unavailable states render', async ({ context, page }) => {
    await signIn(context, EMAILS.admin);
    await page.goto('/service-unavailable');
    await expect(page.getByRole('heading', { name: 'Temporarily unavailable' })).toBeVisible();
    await page.goto('/unauthorized');
    await expect(page.getByRole('heading', { name: 'Not authorized' })).toBeVisible();
  });

  test('unknown membership lands on the provisioned-required page', async ({ context, page }) => {
    await signIn(context, EMAILS.stranger);
    await page.goto('/overview');
    await expect(page.getByRole('heading', { name: 'Your account has not been provisioned' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('desktop smoke: sidebar navigation and sign-out link', async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop-only flow');
    await signIn(context, EMAILS.admin);
    await page.goto('/overview');
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    const signOut = page.getByRole('link', { name: 'Sign out' }).first();
    await expect(signOut).toHaveAttribute('href', '/cdn-cgi/access/logout');
    await page.getByRole('link', { name: 'New request' }).first().click();
    await expect(page).toHaveURL(/\/requests\/new$/);
  });

  test('mobile smoke: drawer navigation is usable at 390x844', async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile-only flow');
    await signIn(context, EMAILS.admin);
    await page.goto('/overview');
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Navigation menu' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name: 'Agents', exact: true }).click();
    await expect(page).toHaveURL(/\/agents$/);
    await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('no horizontal page overflow on key pages', async ({ context, page }) => {
    await signIn(context, EMAILS.admin);
    for (const path of ['/overview', '/agents', '/licenses', '/requests', '/account']) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('customer portal workflows', () => {
  test('customer views licenses and downloads a signed fixture', async ({ context, page }) => {
    await signIn(context, EMAILS.admin);
    await page.goto('/licenses');
    await expect(page.getByRole('heading', { name: 'Licenses', exact: true })).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download signed license' }).first().click(),
    ]);
    expect(download.suggestedFilename()).toContain('license-');
  });

  test('customer submits a license-renewal request', async ({ context, page }) => {
    await signIn(context, EMAILS.admin);
    await page.goto('/requests/new?type=renewal&license=lic-scan-2026');
    await page.getByLabel('Requested duration').selectOption('annual');
    await page.getByLabel('Business reason (optional)').fill('Need continuity for production scanners.');
    await page.getByRole('button', { name: 'Submit request' }).click();
    await expect(page).toHaveURL(/\/requests\/req-/);
    await expect(page.getByText(/Request submitted/).first()).toBeVisible();
    await expect(page.getByText(/lic-scan-2026/).first()).toBeVisible();
  });

  test('customer submits an additional-agent request', async ({ context, page }) => {
    await signIn(context, EMAILS.admin);
    await page.goto('/requests/new?type=agent_access&agent=agent-audit-001');
    await page.getByLabel('Intended use case').fill('Scheduled audit coverage.');
    await page.getByRole('button', { name: 'Submit request' }).click();
    await expect(page).toHaveURL(/\/requests\/req-/);
    await expect(page.getByText('agent-audit-001')).toBeVisible();
  });

  test('customer views the request timeline', async ({ context, page }) => {
    await signIn(context, EMAILS.admin);
    await page.goto('/requests/req-acme-submitted-001');
    await expect(page.getByRole('list', { name: 'Request history' })).toBeVisible();
    await expect(page.getByText(/Request submitted/)).toBeVisible();
    await expect(page.getByText('operatorNote')).toHaveCount(0);
  });

  test('upstream Operator Service failure is recoverable', async ({ context, page }) => {
    await signIn(context, EMAILS.admin);
    const fail = await page.request.post('http://127.0.0.1:8789/e2e/operator-fail');
    expect(fail.ok()).toBeTruthy();
    try {
      await page.goto('/overview');
      await expect(page.getByText('Operator Service unavailable').first()).toBeVisible();
      await expect(page.getByText(/lorem ipsum/i)).toHaveCount(0);
    } finally {
      await page.request.post('http://127.0.0.1:8789/e2e/operator-ok');
    }
  });
});
