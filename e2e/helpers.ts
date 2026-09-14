import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const SERVERS = 'http://127.0.0.1:8789';

export const EMAILS = {
  admin: 'dev.admin@acme.example',
  billing: 'dev.billing@acme.example',
  tech: 'dev.tech@acme.example',
  readonly: 'dev.readonly@acme.example',
  globex: 'dev.admin@globex.example',
  stranger: 'nobody@example.com',
};

export const MACHINE_CREDENTIAL = 'hv_e2eclient00000000000000000000';

/** Mints an Access-shaped JWT for the email and injects it as the dev cookie. */
export async function signIn(context: BrowserContext, email: string): Promise<void> {
  const response = await fetch(`${SERVERS}/sign?email=${encodeURIComponent(email)}`);
  expect(response.ok).toBeTruthy();
  const { token } = (await response.json()) as { token: string };
  await context.addInitScript(
    (jwt) => {
      document.cookie = `PORTAL_DEV_JWT=${jwt}; path=/; samesite=lax`;
    },
    token,
  );
}

/** Records console errors and page exceptions; assertClean verifies none. */
export function trackConsole(page: Page): () => void {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(String(error)));
  return () => expect(problems, `unexpected console errors: ${problems.join(' | ')}`).toEqual([]);
}

export async function newPage(context: BrowserContext): Promise<Page> {
  return context.newPage();
}

export { test, expect };