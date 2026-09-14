/**
 * Worker-runtime D1 helpers.
 *
 * Migrations are applied by tests/worker/apply-migrations.ts using the
 * Miniflare D1 binding provided by @cloudflare/vitest-plugin. Seed SQL is
 * passed in as a test-only binding so this file never reads the filesystem.
 */

import { env } from 'cloudflare:workers';

export interface D1Harness {
  db: D1Database;
  close(): Promise<void>;
}

export function createD1Harness(): D1Harness {
  return {
    db: env.PORTAL_DB,
    async close() {
      // The Worker test environment owns the D1 binding for the file.
    },
  };
}

/** Executes the fictional dev seed (scripts/seed-dev.sql) against a harness DB. */
export async function applyDevSeed(db: D1Database): Promise<void> {
  await execStatements(db, env.TEST_SEED_SQL);
}

/**
 * Miniflare's D1 exec rejects multi-line statements, so each statement is
 * collapsed to a single line before execution. Comments are stripped before
 * splitting (they may contain semicolons); none of the migration files use
 * `--` inside string literals.
 */
async function execStatements(db: D1Database, sql: string): Promise<void> {
  const withoutComments = sql
    .split('\n')
    .map((line) => line.split('--')[0])
    .join(' ');
  const statements = withoutComments
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) {
    await db.exec(statement);
  }
}
