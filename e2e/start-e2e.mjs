/**
 * E2E environment launcher (test-only).
 *
 * 1. Resets the local D1 state, applies migrations, seeds the fictional dev
 *    fixture and creates a machine API test client.
 * 2. Starts the support servers (certs + service stubs) on 127.0.0.1:8789.
 * 3. Starts `wrangler dev` on 127.0.0.1:8788 with test-only vars (dev JWT
 *    cookie accepted, local service URLs).
 * 4. Waits for /api/health on the portal, then hands control to Playwright.
 *
 * All children are killed when the parent exits.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const PORTAL_PORT = 8788;
const SERVERS_PORT = 8789;
const WRANGLER_STATE = join(ROOT, '.wrangler', 'state');

const children = [];

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    console.log(`[e2e] $ ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      stdio: opts.silent ? 'ignore' : 'inherit',
      env: { ...process.env, PATH: `${process.env.HOME}/.nvm/versions/node/v22.23.2/bin:${process.env.PATH}` },
      shell: false,
    });
    children.push(child);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
    child.on('error', reject);
  });
}

async function waitForHealth(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.log(`[e2e] health OK at ${url}`);
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Portal never became healthy at ${url}`);
}

async function main() {
  console.log('[e2e] resetting local D1 state');
  if (existsSync(WRANGLER_STATE)) rmSync(WRANGLER_STATE, { recursive: true, force: true });

  const npx = ['npx', '--no-install', 'wrangler'];
  await run(npx[0], [...npx.slice(1), 'd1', 'migrations', 'apply', 'PORTAL_DB', '--local'], { silent: false });
  await run(npx[0], [...npx.slice(1), 'd1', 'execute', 'PORTAL_DB', '--local', '--file', join(ROOT, 'scripts', 'seed-dev.sql')]);

  // Machine API test client with a deterministic credential (hashed only).
  const credential = 'hv_e2eclient00000000000000000000';
  const hash = createHash('sha256').update(credential).digest('hex');
  const scopes = JSON.stringify(['account:read', 'subscription:read', 'licenses:read', 'agents:read', 'requests:read', 'requests:write']);
  const insertClient = [
    "INSERT OR IGNORE INTO api_clients (id, customer_id, name, credential_hash, credential_prefix, allowed_scopes, status, created_at, expires_at, last_used_at)",
    `VALUES ('cli-e2e-001', 'acme-dev-001', 'E2E Machine Client', '${hash}', 'hv_e2e…', '${scopes}', 'active', '2026-09-01T00:00:00.000Z', NULL, NULL)`,
  ].join(' ');
  await run(npx[0], [...npx.slice(1), 'd1', 'execute', 'PORTAL_DB', '--local', '--command', insertClient]);

  console.log('[e2e] starting support servers');
  const servers = spawn('node', [join(ROOT, 'e2e', 'servers.mjs')], {
    stdio: 'inherit',
    env: { ...process.env, E2E_SERVERS_PORT: String(SERVERS_PORT) },
  });
  children.push(servers);
  await new Promise((resolve) => setTimeout(resolve, 800));

  console.log('[e2e] starting wrangler dev on port ' + PORTAL_PORT);
  const wrangler = spawn('npx', [
    '--no-install',
    'wrangler',
    'dev',
    '--local',
    '--port',
    String(PORTAL_PORT),
    '--var',
    'ACCESS_TEAM_DOMAIN:portal.test',
    '--var',
    'ACCESS_AUD:portal-e2e-aud',
    '--var',
    `ACCESS_CERTS_URL:http://127.0.0.1:${SERVERS_PORT}/certs`,
    '--var',
    'ENVIRONMENT:development',
    '--var',
    `OPERATOR_SERVICE_URL:http://127.0.0.1:${SERVERS_PORT}/operator`,
    '--var',
    `LICENSE_SERVICE_URL:http://127.0.0.1:${SERVERS_PORT}/license`,
  ], {
    stdio: 'inherit',
    env: { ...process.env, PATH: `${process.env.HOME}/.nvm/versions/node/v22.23.2/bin:${process.env.PATH}` },
  });
  children.push(wrangler);

  await waitForHealth(`http://127.0.0.1:${PORTAL_PORT}/api/health`);
  console.log('[e2e] environment ready');
}

function shutdown() {
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // already gone
    }
  }
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

main().catch((error) => {
  console.error('[e2e] startup failed:', error.message);
  shutdown();
  process.exit(1);
});