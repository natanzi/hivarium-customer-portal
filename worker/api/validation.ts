/**
 * Server-side validation for request creation. Every payload is validated at
 * the Worker boundary; the browser and machine clients share the same rules.
 */

import type { RequestPayloadMap, RequestType } from '../../shared/types';
import { REQUEST_TYPE_LABELS } from '../../shared/types';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; problems: string[] };

const REQUEST_TYPES = new Set<RequestType>([
  'renewal',
  'capacity_increase',
  'prepaid_credit',
  'agent_access',
  'license_support',
  'deployment_support',
  'general_support',
]);

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._-]{8,128}$/;

export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && IDEMPOTENCY_KEY_RE.test(value);
}

export interface NormalizedCreateRequest {
  requestType: RequestType;
  title: string;
  reason: string;
  payload: RequestPayloadMap[RequestType];
  idempotencyKey: string;
}

const MAX_STRING_LENGTH = 2000;
const MAX_TITLE_LENGTH = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown, max = MAX_STRING_LENGTH): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

function isOptionalString(value: unknown, max = MAX_STRING_LENGTH): boolean {
  return value === undefined || isString(value, max);
}

function isPositiveInt(value: unknown, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max;
}

/** Rejects unknown top-level keys so the schema stays strict at the boundary. */
function assertOnlyKeys(record: Record<string, unknown>, allowed: string[], problems: string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) problems.push(`Unexpected field "${key}".`);
  }
}

function validateCommon(record: Record<string, unknown>): ValidationResult<{
  title: string;
  reason: string;
  idempotencyKey: string;
  requestType: RequestType;
}> {
  const problems: string[] = [];
  if (!isRecord(record)) {
    return { ok: false, problems: ['Request body must be a JSON object.'] };
  }
  assertOnlyKeys(record, ['requestType', 'title', 'reason', 'payload', 'idempotencyKey'], problems);
  const requestType = record.requestType as RequestType;
  if (!REQUEST_TYPES.has(requestType)) {
    problems.push(`Unsupported request type.`);
  }
  if (record.title !== undefined && !isOptionalString(record.title, MAX_TITLE_LENGTH)) {
    problems.push('Title must be at most 120 characters.');
  }
  if (!isOptionalString(record.reason, MAX_STRING_LENGTH)) {
    problems.push('Reason must be at most 2000 characters.');
  }
  if (!isValidIdempotencyKey(record.idempotencyKey)) {
    problems.push('Idempotency key must be 8-128 characters of letters, digits, dot, dash or underscore.');
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      requestType,
      title: typeof record.title === 'string' ? record.title.trim() : '',
      reason: typeof record.reason === 'string' ? record.reason.trim() : '',
      idempotencyKey: record.idempotencyKey as string,
    },
  };
}

function validatePayload(requestType: RequestType, payload: unknown): ValidationResult<unknown> {
  if (!isRecord(payload)) return { ok: false, problems: ['Payload must be a JSON object.'] };
  const problems: string[] = [];

  switch (requestType) {
    case 'renewal': {
      assertOnlyKeys(payload, ['licenseId', 'desiredTerm', 'notes'], problems);
      if (!isOptionalString(payload.licenseId, 128)) problems.push('licenseId must be at most 128 characters.');
      if (payload.desiredTerm !== undefined && payload.desiredTerm !== 'monthly' && payload.desiredTerm !== 'annual') {
        problems.push('desiredTerm must be "monthly" or "annual".');
      }
      if (!isOptionalString(payload.notes, 1000)) problems.push('notes must be at most 1000 characters.');
      break;
    }
    case 'capacity_increase': {
      assertOnlyKeys(payload, ['capacityType', 'desiredCapacity', 'currentPlan', 'requestedPlan', 'effectiveDatePreference', 'notes'], problems);
      if (payload.capacityType !== undefined && payload.capacityType !== 'seats' && payload.capacityType !== 'agents') {
        problems.push('capacityType must be "seats" or "agents".');
      }
      if (payload.desiredCapacity !== undefined && !isPositiveInt(payload.desiredCapacity, 100_000)) {
        problems.push('desiredCapacity must be an integer between 1 and 100000.');
      }
      if (payload.desiredCapacity === undefined && payload.requestedPlan === undefined) {
        problems.push('desiredCapacity must be an integer between 1 and 100000.');
      }
      if (!isOptionalString(payload.currentPlan, 200)) problems.push('currentPlan must be at most 200 characters.');
      if (!isOptionalString(payload.requestedPlan, 1000)) problems.push('requestedPlan must be at most 1000 characters.');
      if (!isOptionalString(payload.effectiveDatePreference, 64)) problems.push('effectiveDatePreference must be at most 64 characters.');
      if (!isOptionalString(payload.notes, 1000)) problems.push('notes must be at most 1000 characters.');
      break;
    }
    case 'prepaid_credit': {
      assertOnlyKeys(payload, ['amountTokens', 'notes', 'urgency'], problems);
      if (!isPositiveInt(payload.amountTokens, 1_000_000)) {
        problems.push('amountTokens must be an integer between 1 and 1000000.');
      }
      if (!isOptionalString(payload.notes, 1000)) problems.push('notes must be at most 1000 characters.');
      if (payload.urgency !== undefined && payload.urgency !== 'low' && payload.urgency !== 'normal' && payload.urgency !== 'high') {
        problems.push('urgency must be "low", "normal", or "high".');
      }
      break;
    }
    case 'agent_access': {
      assertOnlyKeys(payload, ['agentProductId', 'purpose', 'startDate', 'notes'], problems);
      if (!isString(payload.agentProductId, 128)) {
        problems.push('agentProductId is required and must be at most 128 characters.');
      }
      if (!isOptionalString(payload.purpose, 1000)) problems.push('purpose must be at most 1000 characters.');
      if (!isOptionalString(payload.startDate, 32)) problems.push('startDate must be at most 32 characters.');
      if (!isOptionalString(payload.notes, 1000)) problems.push('notes must be at most 1000 characters.');
      break;
    }
    case 'license_support': {
      assertOnlyKeys(payload, ['licenseId', 'issueDescription', 'notes'], problems);
      if (!isOptionalString(payload.licenseId, 128)) problems.push('licenseId must be at most 128 characters.');
      if (!isString(payload.issueDescription, MAX_STRING_LENGTH)) {
        problems.push('issueDescription is required and must be at most 2000 characters.');
      }
      if (!isOptionalString(payload.notes, 1000)) problems.push('notes must be at most 1000 characters.');
      break;
    }
    case 'deployment_support': {
      assertOnlyKeys(payload, ['deploymentId', 'environment', 'issueDescription', 'notes'], problems);
      if (!isOptionalString(payload.deploymentId, 128)) problems.push('deploymentId must be at most 128 characters.');
      if (!isOptionalString(payload.environment, 64)) problems.push('environment must be at most 64 characters.');
      if (!isString(payload.issueDescription, MAX_STRING_LENGTH)) {
        problems.push('issueDescription is required and must be at most 2000 characters.');
      }
      if (!isOptionalString(payload.notes, 1000)) problems.push('notes must be at most 1000 characters.');
      break;
    }
    case 'general_support': {
      assertOnlyKeys(payload, ['topic', 'subject', 'description', 'notes', 'severity'], problems);
      if (!isOptionalString(payload.topic, 120)) problems.push('topic must be at most 120 characters.');
      if (!isOptionalString(payload.subject, 120)) problems.push('subject must be at most 120 characters.');
      if (!isString(payload.description, MAX_STRING_LENGTH)) {
        problems.push('description is required and must be at most 2000 characters.');
      }
      if (!isOptionalString(payload.notes, 1000)) problems.push('notes must be at most 1000 characters.');
      if (
        payload.severity !== undefined &&
        payload.severity !== 'low' &&
        payload.severity !== 'normal' &&
        payload.severity !== 'high' &&
        payload.severity !== 'urgent'
      ) {
        problems.push('severity must be "low", "normal", "high", or "urgent".');
      }
      break;
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: payload };
}

/** Validates a create-request body and returns normalized fields. */
export function validateCreateRequest(body: unknown): ValidationResult<NormalizedCreateRequest> {
  const common = validateCommon(isRecord(body) ? body : {});
  if (!common.ok) return common;
  const { requestType, title, reason, idempotencyKey } = common.value;
  const record = body as Record<string, unknown>;
  const payload = awaitPayloadValidation(requestType, record.payload);
  if (!payload.ok) return payload;
  return {
    ok: true,
    value: {
      requestType,
      title: title || REQUEST_TYPE_LABELS[requestType],
      reason,
      payload: payload.value as RequestPayloadMap[RequestType],
      idempotencyKey,
    },
  };
}

function awaitPayloadValidation(requestType: RequestType, payload: unknown): ValidationResult<unknown> {
  return validatePayload(requestType, payload);
}

/** Validates a comment body: non-empty message, bounded length. */
export function validateComment(body: unknown): ValidationResult<{ message: string }> {
  if (!isRecord(body)) return { ok: false, problems: ['Comment body must be a JSON object.'] };
  const problems: string[] = [];
  assertOnlyKeys(body, ['message'], problems);
  if (!isString(body.message, MAX_STRING_LENGTH)) {
    problems.push('message is required and must be at most 2000 characters.');
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: { message: (body.message as string).trim() } };
}