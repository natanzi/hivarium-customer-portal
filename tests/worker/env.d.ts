declare namespace Cloudflare {
  interface Env {
    PORTAL_DB: D1Database;
    ASSETS?: Fetcher;
    ENVIRONMENT: string;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    ACCESS_CERTS_URL?: string;
    OPERATOR_SERVICE?: Fetcher;
    LICENSE_SERVICE?: Fetcher;
    OPERATOR_SERVICE_URL?: string;
    LICENSE_SERVICE_URL?: string;
    OPERATOR_SERVICE_TOKEN?: string;
    LICENSE_SERVICE_TOKEN?: string;
    OPERATOR_CALLER_TOKEN?: string;
    TEST_MIGRATIONS: import('@cloudflare/vitest-plugin').D1Migration[];
    TEST_SEED_SQL: string;
  }
}

declare module 'cloudflare:workers' {
  interface ProvidedEnv extends Cloudflare.Env {}
}
