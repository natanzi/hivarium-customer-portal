import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { EMAILS, signIn } from './helpers';

const OUT = join(process.cwd(), '.artifacts', 'screenshots');

test.describe('visual verification captures', () => {
  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
  });

  test('1440x900 overview', async ({ context, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(context, EMAILS.admin);
    await page.goto('/overview');
    await expect(page.getByRole('heading', { name: 'Relationship overview' })).toBeVisible();
    await page.screenshot({ path: join(OUT, 'overview-1440x900.png'), fullPage: true });
  });

  test('1280x800 subscription', async ({ context, page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(context, EMAILS.admin);
    await page.goto('/subscription');
    await expect(page.getByRole('heading', { name: 'Subscription' })).toBeVisible();
    await page.screenshot({ path: join(OUT, 'subscription-1280x800.png'), fullPage: true });
  });

  test('1280x800 agent access', async ({ context, page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(context, EMAILS.admin);
    await page.goto('/agents');
    await expect(page.getByRole('heading', { name: 'Threat Surface Scanner' })).toBeVisible();
    await page.screenshot({ path: join(OUT, 'agents-1280x800.png'), fullPage: true });
  });

  test('1280x800 licenses and deployments', async ({ context, page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(context, EMAILS.admin);
    await page.goto('/licenses');
    await expect(page.getByText('lic-scan-2026')).toBeVisible();
    await page.screenshot({ path: join(OUT, 'licenses-1280x800.png'), fullPage: true });
  });

  test('1280x800 prepaid usage', async ({ context, page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(context, EMAILS.admin);
    await page.goto('/usage');
    await expect(page.getByText('Ledger statement')).toBeVisible();
    await page.screenshot({ path: join(OUT, 'usage-prepaid-1280x800.png'), fullPage: true });
  });

  test('1280x800 request form', async ({ context, page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(context, EMAILS.admin);
    await page.goto('/requests/new');
    await expect(page.getByLabel('Request type')).toBeVisible();
    await page.screenshot({ path: join(OUT, 'request-form-1280x800.png'), fullPage: true });
  });

  test('1280x800 request history', async ({ context, page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(context, EMAILS.admin);
    await page.goto('/requests/req-acme-submitted-001');
    await expect(page.getByRole('list', { name: 'Request history' })).toBeVisible();
    await page.screenshot({ path: join(OUT, 'request-history-1280x800.png'), fullPage: true });
  });

  test('390x844 overview', async ({ context, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(context, EMAILS.admin);
    await page.goto('/overview');
    await expect(page.getByRole('heading', { name: 'Relationship overview' })).toBeVisible();
    await page.screenshot({ path: join(OUT, 'overview-390x844.png'), fullPage: true });
  });

  test('390x844 mobile navigation drawer', async ({ context, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(context, EMAILS.admin);
    await page.goto('/overview');
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    await expect(page.getByRole('dialog', { name: 'Navigation menu' })).toBeVisible();
    await page.screenshot({ path: join(OUT, 'mobile-nav-390x844.png') });
  });

  test('390x844 request form', async ({ context, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(context, EMAILS.admin);
    await page.goto('/requests/new');
    await expect(page.getByLabel('Request type')).toBeVisible();
    await page.screenshot({ path: join(OUT, 'request-form-390x844.png'), fullPage: true });
  });

  test('service unavailable state', async ({ context, page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(context, EMAILS.admin);
    await page.goto('/service-unavailable');
    await expect(page.getByRole('heading', { name: 'Temporarily unavailable' })).toBeVisible();
    await page.screenshot({ path: join(OUT, 'service-unavailable-1280x800.png') });
  });

  test('unauthorized state', async ({ context, page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(context, EMAILS.admin);
    await page.goto('/unauthorized');
    await expect(page.getByRole('heading', { name: 'Not authorized' })).toBeVisible();
    await page.screenshot({ path: join(OUT, 'unauthorized-1280x800.png') });
  });
});