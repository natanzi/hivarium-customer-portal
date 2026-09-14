/**
 * Miniflare-backed D1 test harness.
 *
 * Runs the real migration SQL against a real local SQLite D1 database so the
 * repository and handler integration tests exercise genuine SQL semantics
 * (constraints, transactions, indexes).
 */

import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface D1Harness {
  db: D1Database;
  mf: Miniflare;
  close(): Promise<void>;
}

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

export async function createD1Harness(dbName = 'test-portal-db'): Promise<D1Harness> {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } };',
      d1Databases: { PORTAL_DB: dbName },
    }),
  );
  const db = (await mf.getD1Database('PORTAL_DB')) as unknown as D1Database;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await execStatements(db, sql);
  }

  return {
    db,
    mf,
    async close() {
      await mf.dispose();
    },
  };
}

/** Executes the fictional dev seed (scripts/seed-dev.sql) against a harness DB. */
export async function applyDevSeed(db: D1Database): Promise<void> {
  const sql = readFileSync(join(process.cwd(), 'scripts', 'seed-dev.sql'), 'utf8');
  await execStatements(db, sql);
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