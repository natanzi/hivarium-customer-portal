/** portal_audit_log repository — append-only by construction. */

import { isoNow, newId } from '../../util';

export interface AuditEntryInput {
  customerId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
  now?: string;
}

export async function insertAuditEntry(
  db: D1Database,
  input: AuditEntryInput,
): Promise<string> {
  const id = newId('aud');
  await db
    .prepare(
      `INSERT INTO portal_audit_log
        (id, customer_id, actor_email, action, target_type, target_id, metadata_json, correlation_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      id,
      input.customerId,
      input.actorEmail,
      input.action,
      input.targetType,
      input.targetId ?? '',
      JSON.stringify(input.metadata ?? {}),
      input.correlationId ?? '',
      input.now ?? isoNow(),
    )
    .run();
  return id;
}

export interface AuditEntryRow {
  id: string;
  customerId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  correlationId: string;
  createdAt: string;
}

export async function listAuditEntriesByCustomer(
  db: D1Database,
  customerId: string,
  limit = 100,
): Promise<AuditEntryRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, customer_id, actor_email, action, target_type, target_id, metadata_json, correlation_id, created_at
       FROM portal_audit_log
       WHERE customer_id = ?1
       ORDER BY created_at DESC
       LIMIT ?2`,
    )
    .bind(customerId, limit)
    .all<{
      id: string;
      customer_id: string;
      actor_email: string;
      action: string;
      target_type: string;
      target_id: string;
      metadata_json: string;
      correlation_id: string;
      created_at: string;
    }>();
  return rows.results.map((row) => ({
    id: row.id,
    customerId: row.customer_id,
    actorEmail: row.actor_email,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: safeParse(row.metadata_json),
    correlationId: row.correlation_id,
    createdAt: row.created_at,
  }));
}

function safeParse(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}