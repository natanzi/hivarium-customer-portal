-- Evaluation membership expiry. Existing rows remain active with no expiry.

ALTER TABLE portal_memberships ADD COLUMN demo_expires_at TEXT;
