-- 0003_machine_api.sql
-- Machine-client credentials and request idempotency records.
--
-- api_clients stores only a SHA-256 hash of each credential and a short,
-- non-secret prefix for display. Raw credentials are never stored. Credential
-- issuance is intentionally DISABLED in this MVP; rows can only be created by
-- operators with direct database access (see docs/machine-api.md).
--
-- idempotency_records keys a mutation to (customer_id, operation,
-- idempotency_key) so retried requests return the original result instead of
-- creating duplicates. Records expire and are pruned by the application.

CREATE TABLE api_clients (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  credential_hash TEXT NOT NULL,
  credential_prefix TEXT NOT NULL DEFAULT '',
  allowed_scopes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'expired', 'revoked')),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT
);

CREATE INDEX idx_api_clients_customer ON api_clients (customer_id);
CREATE UNIQUE INDEX idx_api_clients_hash ON api_clients (credential_hash);

CREATE TABLE idempotency_records (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (customer_id, operation, idempotency_key)
);

CREATE INDEX idx_idempotency_expiry ON idempotency_records (expires_at);