-- 0004_operator_request_service.sql
-- Extend request status to include `needs_information` for Operator Console
-- decisions. Existing rows are copied unchanged. SQLite cannot ALTER a CHECK
-- constraint in place, so the requests table is rebuilt (data-preserving).
--
-- child events are copied first so the parent table can be replaced without
-- a FOREIGN KEY failure. Historical event rows are not rewritten.
--
-- Operator notes, principal attribution, external references and decision
-- idempotency keys live in append-only event metadata and idempotency_records.

CREATE TABLE customer_request_events_new (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created',
    'status_changed',
    'comment',
    'cancelled',
    'completed',
    'operator_note',
    'system'
  )),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('customer', 'operator', 'system')),
  actor_reference TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

INSERT INTO customer_request_events_new (
  id, request_id, customer_id, event_type, actor_type, actor_reference, message, metadata_json, created_at
)
SELECT
  id, request_id, customer_id, event_type, actor_type, actor_reference, message, metadata_json, created_at
FROM customer_request_events;

DROP TABLE customer_request_events;

CREATE TABLE customer_requests_new (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  requested_by_membership_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN (
    'renewal',
    'capacity_increase',
    'prepaid_credit',
    'agent_access',
    'license_support',
    'deployment_support',
    'general_support'
  )),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
    'submitted',
    'in_review',
    'needs_information',
    'approved',
    'rejected',
    'completed',
    'cancelled'
  )),
  title TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  structured_payload_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  completed_at TEXT
);

INSERT INTO customer_requests_new (
  id, customer_id, requested_by_membership_id, request_type, status, title, reason,
  structured_payload_json, idempotency_key, created_at, updated_at, cancelled_at, completed_at
)
SELECT
  id, customer_id, requested_by_membership_id, request_type, status, title, reason,
  structured_payload_json, idempotency_key, created_at, updated_at, cancelled_at, completed_at
FROM customer_requests;

DROP TABLE customer_requests;
ALTER TABLE customer_requests_new RENAME TO customer_requests;

CREATE INDEX idx_requests_customer ON customer_requests (customer_id, created_at DESC);
CREATE INDEX idx_requests_status ON customer_requests (status);
CREATE INDEX idx_requests_created ON customer_requests (created_at DESC);
CREATE INDEX idx_requests_customer_status ON customer_requests (customer_id, status);
CREATE INDEX idx_requests_type ON customer_requests (request_type);
CREATE INDEX idx_requests_created_id ON customer_requests (created_at DESC, id DESC);

CREATE TABLE customer_request_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES customer_requests (id),
  customer_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created',
    'status_changed',
    'comment',
    'cancelled',
    'completed',
    'operator_note',
    'system'
  )),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('customer', 'operator', 'system')),
  actor_reference TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

INSERT INTO customer_request_events (
  id, request_id, customer_id, event_type, actor_type, actor_reference, message, metadata_json, created_at
)
SELECT
  id, request_id, customer_id, event_type, actor_type, actor_reference, message, metadata_json, created_at
FROM customer_request_events_new;

DROP TABLE customer_request_events_new;

CREATE INDEX idx_events_request ON customer_request_events (request_id, created_at);
CREATE INDEX idx_events_customer ON customer_request_events (customer_id, created_at DESC);
