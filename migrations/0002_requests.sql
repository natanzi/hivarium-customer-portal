-- 0002_requests.sql
-- Customer-originated service requests, their append-only event history, and
-- the portal audit log.
--
-- The portal owns these rows. Statuses other than `submitted` are expected to
-- be driven by operator decisions executed through the Operator Console and
-- synchronized into the portal by the (documented, not yet implemented)
-- inbound request-status sync. The portal itself never fabricates operator
-- decisions.

CREATE TABLE customer_requests (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  -- Logical reference to portal_memberships.id for customer-created requests;
  -- machine-created requests store `machine:<clientId>` here instead. The
  -- portal keeps membership references correct by construction (no FK), so
  -- machine actors never violate referential integrity.
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

CREATE INDEX idx_requests_customer ON customer_requests (customer_id, created_at DESC);
CREATE INDEX idx_requests_status ON customer_requests (status);
CREATE INDEX idx_requests_created ON customer_requests (created_at DESC);

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

CREATE INDEX idx_events_request ON customer_request_events (request_id, created_at);
CREATE INDEX idx_events_customer ON customer_request_events (customer_id, created_at DESC);

CREATE TABLE portal_audit_log (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  correlation_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_customer ON portal_audit_log (customer_id, created_at DESC);
CREATE INDEX idx_audit_actor ON portal_audit_log (actor_email);
CREATE INDEX idx_audit_correlation ON portal_audit_log (correlation_id);