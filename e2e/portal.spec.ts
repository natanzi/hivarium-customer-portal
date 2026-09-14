import { expect, test } from '@playwright/test';
import { EMAILS, MACHINE_CREDENTIAL, signIn, trackConsole } from './helpers';

test.describe('portal smoke and navigation', () => {
  test('authenticated customer reaches the overview', async ({ context, page }) => {
    const assertClean = trackConsole(page);
    await signIn(context, EMAILS.admin);
    await page.goto('/overview');
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByRole('heading', { name: 'Relationship overview' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Relationship' })).toContainText('Acme Instruments (Dev Fixture)');
    await expect(page.getByRole('region', { name: 'Relationship' })).toContainText('Prepaid tokens');
    assertClean();
  });

  test('root redirect completes and never stalls on a redirect message', async ({ context, page }) => {
    const assertClean = trackConsole(page);
    await signIn(context, EMAILS.admin);
    await page.goto('/');
    await expect(page).toHaveURL(/\/overview$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Relationship overview' })).toBeVisible();
    await expect(page.getByText('Redirecting')).toHaveCount(0);
    assertClean();
  });

  test('overview to subscription navigation', async ({ context, page }, testInfo) => {
    await signIn(context, EMAILS.admin);
    await page.goto('/overview');
    if (testInfo.project.name === 'mobile') {
      await page.getByRole('button', { name: 'Open navigation menu' }).click();
      await page.getByRole('dialog', { name: 'Navigation menu' }).getByRole('link', { name: 'Subscription', exact: true }).click();
    } else {
      await page.getByRole('link', { name: 'Subscription', exact: true }).click();
    }
    await expect(page).toHaveURL(/\/subscription$/);
    await expect(page.getByRole('heading', { name: 'Subscription' })).toBeVisible();
    await expect(page.getByText('Prepaid tokens').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Request renewal' })).toBeVisible();
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
    await expect(page.getByRole('link', { name: 'Request agent access' })).toBeVisible();
  });

  test('license and deployment display', async ({ context, page }) => {
    await signIn(context, EMAILS.admin);
    await page.goto('/licenses');
    await expect(page.getByRole('heading', { name: 'Licenses & deployments' })).toBeVisible();
    await expect(page.getByText('lic-scan-2026')).toBeVisible();
    await expect(page.getByText('dep-prod-001')).toBeVisible();
    await expect(page.getByText('1 / 3')).toBeVisible();
    await expect(page.getByText('Online')).toBeVisible();
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
    await page.getByLabel(/Desired capacity/).fill('15');
    await page.getByLabel('Notes').fill('E2E batch run.');
    await page.getByRole('button', { name: 'Submit request' }).click();
    await expect(page).toHaveURL(/\/requests\/req-/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Capacity increase' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel request' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Capacity increase' })).toBeVisible();
    await expect(page.getByText('E2E batch run.')).toBeVisible();
    assertClean();
  });

  test('cancel a submitted request and the state is protected afterwards', async ({ context, page }) => {
    await signIn(context, EMAILS.admin);
    await page.goto('/requests/new');
    await page.getByLabel('Request type').selectOption('general_support');
    await page.getByLabel('Description').fill('Please cancel me after creation.');
    await page.getByRole('button', { name: 'Submit request' }).click();
    await expect(page).toHaveURL(/\/requests\/req-/, { timeout: 10_000 });

    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Cancel request' }).click();
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

  test('unknown membership lands on the unauthorized page', async ({ context, page }) => {
    await signIn(context, EMAILS.stranger);
    await page.goto('/overview');
    await expect(page.getByRole('heading', { name: 'Not authorized' })).toBeVisible({ timeout: 10_000 });
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
    await drawer.getByRole('link', { name: 'Usage' }).click();
    await expect(page).toHaveURL(/\/usage$/);
    await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('no horizontal page overflow on key pages', async ({ context, page }) => {
    await signIn(context, EMAILS.admin);
    for (const path of ['/overview', '/subscription', '/agents', '/licenses', '/usage', '/requests']) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
    }
  });
});