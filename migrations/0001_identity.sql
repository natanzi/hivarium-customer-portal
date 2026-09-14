-- 0001_identity.sql
-- Portal identity and tenancy foundation.
--
-- portal_memberships maps an authenticated user (verified by the Cloudflare
-- Access JWT) to a customer tenant and a portal role. The portal derives the
-- active customer id and role exclusively from this table on the server.

CREATE TABLE portal_memberships (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('customer_admin', 'billing_viewer', 'technical_operator', 'read_only')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (customer_id, email_normalized)
);

CREATE INDEX idx_memberships_email ON portal_memberships (email_normalized);
CREATE INDEX idx_memberships_customer ON portal_memberships (customer_id);