/**
 * api_clients repository for machine credentials.
 *
 * Only credential hashes are stored; raw credentials never touch the
 * database. Issuance is disabled in this MVP (no self-service or operator
 * endpoint exists yet) — rows are created through operator database tooling,
 * and the credential format is documented in docs/machine-api.md.
 */

import type { MachineScope } from '../../../shared/types';
import { isoNow, newId, sha256Hex } from '../../util';

export interface ApiClientRow {
  id: string;
  customerId: string;
  name: string;
  credentialPrefix: string;
  allowedScopes: MachineScope[];
  status: 'active' | 'disabled' | 'expired' | 'revoked';
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

interface ApiClientDbRow {
  id: string;
  customer_id: string;
  name: string;
  credential_hash: string;
  credential_prefix: string;
  allowed_scopes: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
}

function mapClient(row: ApiClientDbRow): ApiClientRow {
  let scopes: MachineScope[] = [];
  try {
    const parsed = JSON.parse(row.allowed_scopes);
    if (Array.isArray(parsed)) {
      scopes = parsed.filter((s): s is MachineScope => typeof s === 'string' && isMachineScope(s));
    }
  } catch {
    scopes = [];
  }
  return {
    id: row.id,
    customerId: row.customer_id,
    name: row.name,
    credentialPrefix: row.credential_prefix,
    allowedScopes: scopes,
    status: row.status as ApiClientRow['status'],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
  };
}

function isMachineScope(value: string): boolean {
  return ['account:read', 'subscription:read', 'licenses:read', 'agents:read', 'requests:read', 'requests:write'].includes(value);
}

export async function findClientByCredential(
  db: D1Database,
  credential: string,
): Promise<ApiClientRow | null> {
  const hash = await sha256Hex(credential);
  const row = await db
    .prepare(
      `SELECT id, customer_id, name, credential_hash, credential_prefix, allowed_scopes,
              status, created_at, expires_at, last_used_at
       FROM api_clients
       WHERE credential_hash = ?1`,
    )
    .bind(hash)
    .first<ApiClientDbRow>();
  return row ? mapClient(row) : null;
}

export async function touchClientLastUsed(db: D1Database, clientId: string): Promise<void> {
  await db
    .prepare(`UPDATE api_clients SET last_used_at = ?1 WHERE id = ?2`)
    .bind(isoNow(), clientId)
    .run();
}

export interface CreateClientInput {
  customerId: string;
  name: string;
  credential: string;
  scopes: MachineScope[];
  expiresAt?: string;
  status?: ApiClientRow['status'];
  id?: string;
}

/** Operator database tooling / deterministic tests only. Not exposed over HTTP. */
export async function createClient(db: D1Database, input: CreateClientInput): Promise<ApiClientRow> {
  const hash = await sha256Hex(input.credential);
  const row = await db
    .prepare(
      `INSERT INTO api_clients
        (id, customer_id, name, credential_hash, credential_prefix, allowed_scopes, status, created_at, expires_at, last_used_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL)`,
    )
    .bind(
      input.id ?? newId('cli'),
      input.customerId,
      input.name,
      hash,
      credentialPrefix(input.credential),
      JSON.stringify(input.scopes),
      input.status ?? 'active',
      isoNow(),
      input.expiresAt ?? null,
    )
    .run();
  return {
    id: (row.meta.last_row_id as unknown as string) || input.id || '',
    customerId: input.customerId,
    name: input.name,
    credentialPrefix: credentialPrefix(input.credential),
    allowedScopes: input.scopes,
    status: input.status ?? 'active',
    createdAt: isoNow(),
    expiresAt: input.expiresAt ?? null,
    lastUsedAt: null,
  };
}

export function credentialPrefix(credential: string): string {
  return credential.length <= 8 ? credential : `${credential.slice(0, 4)}…${credential.slice(-4)}`;
}

/** Generates a `hv_`-prefixed random credential. Only the hash is stored. */
export async function generateCredential(): Promise<string> {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `hv_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}