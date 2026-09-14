import { ApiError } from './errors';
import { isValidIdempotencyKey } from './validation';
import { normalizeEmail } from '../util';
import {
  parseMembershipRole,
  parseMembershipStatus,
  upsertMembershipForOperator,
} from '../db/repos/operator-memberships';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function handleOperatorUpsertMembership(
  db: D1Database,
  customerId: string,
  emailParam: string,
  payload: unknown,
  correlationId: string,
): Promise<{ membershipId: string; replayed: boolean }> {
  if (!customerId || customerId.length > 128) {
    throw new ApiError(400, 'invalid_request', 'customerId is invalid.');
  }
  if (!isRecord(payload)) {
    throw new ApiError(400, 'invalid_request', 'Body must be a JSON object.');
  }
  const email = normalizeEmail(decodeURIComponent(emailParam));
  if (!email.includes('@') || email.length > 254) {
    throw new ApiError(400, 'invalid_request', 'email is invalid.');
  }
  const displayName = typeof payload.displayName === 'string' ? payload.displayName.trim() : '';
  if (!displayName || displayName.length > 120) {
    throw new ApiError(400, 'invalid_request', 'displayName is invalid.');
  }
  const role = parseMembershipRole(payload.role);
  const status = parseMembershipStatus(payload.status);
  const demoExpiresAt =
    payload.demoExpiresAt === null || payload.demoExpiresAt === undefined
      ? null
      : typeof payload.demoExpiresAt === 'string'
        ? payload.demoExpiresAt
        : (() => {
            throw new ApiError(400, 'invalid_request', 'demoExpiresAt is invalid.');
          })();
  const idempotencyKey = payload.idempotencyKey;
  if (!isValidIdempotencyKey(idempotencyKey)) {
    throw new ApiError(400, 'invalid_request', 'idempotencyKey is invalid.');
  }
  const result = await upsertMembershipForOperator(db, {
    customerId,
    email,
    displayName,
    role,
    status,
    demoExpiresAt,
    idempotencyKey,
    correlationId: typeof payload.correlationId === 'string' ? payload.correlationId : correlationId,
  });
  return { membershipId: result.membership.id, replayed: result.replayed };
}
