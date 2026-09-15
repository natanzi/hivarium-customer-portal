-- 0006_magic_link_auth.sql
-- First-party customer magic-link sign-in and first-party portal sessions.
--
-- Design notes:
--   * magic_link_challenges are single-use, 10-minute sign-in challenges.
--     Only the SHA-256 hex hash of a 256-bit token is stored; the raw token
--     exists only in the emailed link and in memory for the lifetime of the
--     request that created it. Raw login/token values are never persisted.
--   * Challenges reference the membership (and, when the email is
--     unprovisioned, NULL customer_id) rather than an email. The normalized
--     request email is not stored in the challenge row; throttle lookups are
--     keyed by a SHA-256 hash of the normalized email.
--   * magic_link_throttle provides durable (D1-backed) throttle state keyed
--     on SHA-256 hashes only. Neither the raw email nor the raw source IP is
--     ever stored. Window boundaries are enforced in the repository (the
--     schema keeps the last request timestamp and count per key).
--   * Consumption is atomic and idempotent at the schema level: the
--     repository marks a challenge consumed only when it is still active,
--     and the partial UNIQUE index plus portal_sessions'
--     UNIQUE (challenge_id) make a second session per challenge impossible.
--     Deterministic replay resistance (consumed + same session) is checked
--     in the repository before the atomic claim.
--   * consumed_at and consumed_session_id are written together by the
--     atomic claim (a CHECK enforces they are both NULL or both non-NULL),
--     so a consumed row always names the session it bound.
--   * invalidated_at marks a challenge superseded by a newer one
--     (single-active-link semantics). Invalidated rows are unconsumed and
--     unbound; every find/consume path rejects them. Expired challenges are
--     reported as expired without being mutated, so they never carry a fake
--     consumed state.
--   * portal_sessions are first-party session tokens. Only the SHA-256 hex
--     hash of the 256-bit session token is stored; the raw token is placed
--     in the HttpOnly cookie. A session is tied to exactly the consumed
--     challenge (challenge_id), the membership, and the customer. A session
--     can never outlive the membership's demo_expires_at; the caller caps
--     expires_at (24h maximum) and the repository re-checks the bound at
--     resolve time in addition to expires_at.
--   * The migration is forward-only: it only adds tables and indexes.

CREATE TABLE magic_link_challenges (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  membership_id TEXT,
  customer_id TEXT,
  ip_hash TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumed_session_id TEXT,
  invalidated_at TEXT,
  -- A challenge is either untouched (both NULL) or claimed by exactly one
  -- session (both set). The atomic claim writes them together.
  CHECK ((consumed_at IS NULL) = (consumed_session_id IS NULL))
);

-- Lookups by membership (single-active-challenge enforcement) and by the
-- consuming session.
CREATE INDEX idx_magic_link_membership ON magic_link_challenges (membership_id, created_at DESC);
CREATE INDEX idx_magic_link_session ON magic_link_challenges (consumed_session_id);
-- Pruning of long-expired challenges by the repository.
CREATE INDEX idx_magic_link_expires ON magic_link_challenges (expires_at);

-- Partial unique index: at most one active challenge exists per membership
-- at any time. It gives deterministic replay resistance at the schema level
-- (same email, same customer, one pending link) and keeps atomic challenge
-- consumption unambiguous. A challenge stops being active when it is
-- consumed (bound to a session) or invalidated (superseded by a newer one).
CREATE UNIQUE INDEX idx_magic_link_unique_unconsumed
  ON magic_link_challenges (membership_id)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

-- Durable, hashed-keyed throttle state for magic-link requests.
CREATE TABLE magic_link_throttle (
  key_hash TEXT NOT NULL,
  key_kind TEXT NOT NULL CHECK (key_kind IN ('email', 'ip')),
  window_key TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  first_request_at TEXT NOT NULL,
  last_request_at TEXT NOT NULL,
  PRIMARY KEY (key_hash, key_kind, window_key)
);

-- Window-based pruning by the repository.
CREATE INDEX idx_magic_link_throttle_window ON magic_link_throttle (window_key);

CREATE TABLE portal_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_via TEXT NOT NULL DEFAULT 'magic_link'
);

-- Exactly one session per challenge token: even if two rows existed for the
-- same challenge for any reason, only the first one is resolvable — the
-- UNIQUE constraint makes duplicates impossible at the DDL level.
CREATE UNIQUE INDEX idx_portal_sessions_challenge ON portal_sessions (challenge_id);
CREATE INDEX idx_portal_sessions_member ON portal_sessions (membership_id, expires_at DESC);
CREATE INDEX idx_portal_sessions_expiry ON portal_sessions (expires_at);
