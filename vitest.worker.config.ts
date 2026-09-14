import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  const seedSql = readFileSync(path.join(import.meta.dirname, 'scripts/seed-dev.sql'), 'utf8');

  return {
    plugins: [
      cloudflareTest({
        wrangler: {
          configPath: './wrangler.jsonc',
        },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_SEED_SQL: seedSql,
            ENVIRONMENT: 'test',
            ACCESS_TEAM_DOMAIN: 'portal.test',
            ACCESS_AUD: 'portal-e2e-aud',
          },
        },
      }),
    ],
    test: {
      include: ['tests/worker/**/*.test.ts'],
      exclude: ['tests/worker/access-jwt.test.ts', 'tests/worker/adapters.test.ts'],
      setupFiles: ['./tests/worker/apply-migrations.ts'],
      testTimeout: 30_000,
    },
  };
});
