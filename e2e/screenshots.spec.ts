import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { EMAILS, signIn } from './helpers';

const OUT = join(process.cwd(), '.artifacts', 'customer-portal');

test.describe('visual verification captures', () => {
  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
  });

  test('overview-1920', async ({ context, page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await signIn(context, EMAILS.admin);
    await page.goto('/overview');
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Organization' })).toContainText('Acme Instruments');
    await page.screenshot({ path: join(OUT, 'overview-1920.png'), fullPage: true });
  });

  test('agents-1920', async ({ context, page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await signIn(context, EMAILS.admin);
    await page.goto('/agents');
    await expect(page.getByRole('heading', { name: 'Threat Surface Scanner' })).toBeVisible();
    await page.screenshot({ path: join(OUT, 'agents-1920.png'), fullPage: true });
  });

  test('licenses-1920', async ({ context, page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await signIn(context, EMAILS.admin);
    await page.goto('/licenses');
    await expect(page.getByText('lic-scan-2026').first()).toBeVisible();
    await page.screenshot({ path: join(OUT, 'licenses-1920.png'), fullPage: true });
  });

  test('requests-1920', async ({ context, page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await signIn(context, EMAILS.admin);
    await page.goto('/requests');
    await expect(page.getByRole('heading', { name: 'Requests', exact: true })).toBeVisible();
    await page.screenshot({ path: join(OUT, 'requests-1920.png'), fullPage: true });
  });

  test('new-request-1920', async ({ context, page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await signIn(context, EMAILS.admin);
    await page.goto('/requests/new');
    await expect(page.getByLabel('Request type')).toBeVisible();
    await page.screenshot({ path: join(OUT, 'new-request-1920.png'), fullPage: true });
  });

  test('request-timeline-1920', async ({ context, page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await signIn(context, EMAILS.admin);
    await page.goto('/requests/req-acme-submitted-001');
    await expect(page.getByRole('list', { name: 'Request history' })).toBeVisible();
    await page.screenshot({ path: join(OUT, 'request-timeline-1920.png'), fullPage: true });
  });

  test('upstream-error-1920', async ({ context, page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await signIn(context, EMAILS.admin);
    const fail = await page.request.post('http://127.0.0.1:8789/e2e/operator-fail');
    expect(fail.ok()).toBeTruthy();
    try {
      await page.goto('/overview');
      await expect(page.getByText('Operator Service unavailable').first()).toBeVisible();
      await page.screenshot({ path: join(OUT, 'upstream-error-1920.png'), fullPage: true });
    } finally {
      await page.request.post('http://127.0.0.1:8789/e2e/operator-ok');
    }
  });

  test('overview-mobile-390', async ({ context, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(context, EMAILS.admin);
    await page.goto('/overview');
    await expect(page.getByRole('region', { name: 'Organization' })).toContainText('Acme Instruments');
    await page.screenshot({ path: join(OUT, 'overview-mobile-390.png'), fullPage: true });
  });

  test('mobile-menu-390', async ({ context, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(context, EMAILS.admin);
    await page.goto('/overview');
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    await expect(page.getByRole('dialog', { name: 'Navigation menu' })).toBeVisible();
    await page.screenshot({ path: join(OUT, 'mobile-menu-390.png') });
  });
});
