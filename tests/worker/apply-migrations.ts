import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

await applyD1Migrations(env.PORTAL_DB, env.TEST_MIGRATIONS);
