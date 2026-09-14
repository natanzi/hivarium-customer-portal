-- scripts/seed-dev.sql
--
-- DETERMINISTIC LOCAL DEVELOPMENT SEED DATA — FICTIONAL ONLY.
--
-- All customers, memberships, requests and events below are invented fixtures
-- for local development and automated tests. They use `.example` email
-- addresses that Cloudflare Access cannot issue and a customer id that has no
-- counterpart in any real Operator Console.
--
-- SAFETY RULES:
--   * This file lives OUTSIDE migrations/ on purpose: `wrangler d1 migrations
--     apply` can never pick it up, so it cannot be applied to the remote
--     production database by accident.
--   * It is applied ONLY through `npm run db:seed:dev`, which hard-codes
--     `--local`. Never run it with `--remote`.
--   * Every statement is idempotent (INSERT OR IGNORE).

INSERT OR IGNORE INTO portal_memberships (id, customer_id, email_normalized, display_name, role, status, created_at, updated_at) VALUES
  ('mbr-acme-admin-001',    'acme-dev-001',    'dev.admin@acme.example',     'Dev Admin (Fixture)',        'customer_admin',     'active',   '2026-01-02T09:00:00.000Z', '2026-01-02T09:00:00.000Z'),
  ('mbr-acme-billing-001',  'acme-dev-001',    'dev.billing@acme.example',   'Dev Billing (Fixture)',      'billing_viewer',     'active',   '2026-01-02T09:00:00.000Z', '2026-01-02T09:00:00.000Z'),
  ('mbr-acme-tech-001',     'acme-dev-001',    'dev.tech@acme.example',      'Dev Technical (Fixture)',    'technical_operator', 'active',   '2026-01-02T09:00:00.000Z', '2026-01-02T09:00:00.000Z'),
  ('mbr-acme-readonly-001', 'acme-dev-001',    'dev.readonly@acme.example',  'Dev Read-Only (Fixture)',    'read_only',          'active',   '2026-01-02T09:00:00.000Z', '2026-01-02T09:00:00.000Z'),
  ('mbr-acme-disabled-001', 'acme-dev-001',    'dev.disabled@acme.example',  'Dev Disabled (Fixture)',     'customer_admin',     'disabled', '2026-01-02T09:00:00.000Z', '2026-02-01T09:00:00.000Z'),
  ('mbr-globex-admin-001',  'globex-dev-002',  'dev.admin@globex.example',   'Dev Admin Globex (Fixture)', 'customer_admin',     'active',   '2026-01-02T09:00:00.000Z', '2026-01-02T09:00:00.000Z');

INSERT OR IGNORE INTO customer_requests
  (id, customer_id, requested_by_membership_id, request_type, status, title, reason, structured_payload_json, idempotency_key, created_at, updated_at, cancelled_at, completed_at)
VALUES
  ('req-acme-submitted-001', 'acme-dev-001', 'mbr-acme-admin-001',
   'capacity_increase', 'submitted', 'Capacity increase', 'Preparing for a larger evaluation batch.',
   '{"capacityType":"agents","desiredCapacity":8,"notes":"Q3 evaluation batch"}',
   'seed-capacity-001', '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z', NULL, NULL),
  ('req-acme-approved-001',  'acme-dev-001', 'mbr-acme-admin-001',
   'renewal', 'approved', 'Renewal request', 'Extend the current annual contract.',
   '{"desiredTerm":"annual","notes":"Renew for another year"}',
   'seed-renewal-001', '2026-07-15T10:00:00.000Z', '2026-08-01T10:00:00.000Z', NULL, NULL),
  ('req-acme-cancelled-001','acme-dev-001', 'mbr-acme-tech-001',
   'agent_access', 'cancelled', 'Agent access', 'No longer needed.',
   '{"agentProductId":"agent-scan-001","purpose":"Trial"}',
   'seed-agent-001', '2026-06-10T10:00:00.000Z', '2026-06-12T10:00:00.000Z', '2026-06-12T10:00:00.000Z', NULL);

INSERT OR IGNORE INTO customer_request_events
  (id, request_id, customer_id, event_type, actor_type, actor_reference, message, metadata_json, created_at)
VALUES
  ('evt-req1-created-001',  'req-acme-submitted-001', 'acme-dev-001', 'created',  'customer', 'mbr-acme-admin-001', 'Request submitted.',          '{"idempotencyKey":"seed-capacity-001"}', '2026-08-20T10:00:00.000Z'),
  ('evt-req2-created-001',  'req-acme-approved-001',  'acme-dev-001', 'created',  'customer', 'mbr-acme-admin-001', 'Request submitted.',          '{"idempotencyKey":"seed-renewal-001"}',  '2026-07-15T10:00:00.000Z'),
  ('evt-req2-status-001',   'req-acme-approved-001',  'acme-dev-001', 'status_changed', 'operator', 'operator-console', 'Approved by operator.',      '{}',                                     '2026-08-01T10:00:00.000Z'),
  ('evt-req3-created-001',  'req-acme-cancelled-001', 'acme-dev-001', 'created',  'customer', 'mbr-acme-tech-001', 'Request submitted.',          '{"idempotencyKey":"seed-agent-001"}',    '2026-06-10T10:00:00.000Z'),
  ('evt-req3-cancel-001',   'req-acme-cancelled-001', 'acme-dev-001', 'cancelled','customer', 'mbr-acme-tech-001', 'Request cancelled by customer.','{}',                                    '2026-06-12T10:00:00.000Z');

INSERT OR IGNORE INTO portal_audit_log
  (id, customer_id, actor_email, action, target_type, target_id, metadata_json, correlation_id, created_at)
VALUES
  ('aud-req1-001', 'acme-dev-001', 'dev.admin@acme.example', 'request.create', 'customer_request', 'req-acme-submitted-001', '{"requestType":"capacity_increase"}', 'seed-0001', '2026-08-20T10:00:00.000Z');