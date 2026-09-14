/**
 * Translation between portal-internal D1 enum names and Operator Console
 * service DTO names. Historical rows keep internal names; only the
 * `/service/v1` boundary emits and accepts canonical external values.
 */

import type { RequestStatus, RequestType } from '../../shared/types';

export type ExternalRequestType =
  | 'license_renewal'
  | 'plan_change'
  | 'additional_agent_access'
  | 'token_credit'
  | 'support';

export type ExternalRequestStatus =
  | 'submitted'
  | 'under_review'
  | 'needs_information'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'cancelled';

export class IntegrationMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationMappingError';
  }
}

const INTERNAL_REQUEST_TYPES: readonly RequestType[] = [
  'renewal',
  'capacity_increase',
  'prepaid_credit',
  'agent_access',
  'license_support',
  'deployment_support',
  'general_support',
];

const INTERNAL_REQUEST_STATUSES: readonly RequestStatus[] = [
  'submitted',
  'in_review',
  'needs_information',
  'approved',
  'rejected',
  'completed',
  'cancelled',
];

const EXTERNAL_REQUEST_TYPES: readonly ExternalRequestType[] = [
  'license_renewal',
  'plan_change',
  'additional_agent_access',
  'token_credit',
  'support',
];

const EXTERNAL_REQUEST_STATUSES: readonly ExternalRequestStatus[] = [
  'submitted',
  'under_review',
  'needs_information',
  'approved',
  'rejected',
  'completed',
  'cancelled',
];

export function isRequestType(value: unknown): value is RequestType {
  return typeof value === 'string' && (INTERNAL_REQUEST_TYPES as readonly string[]).includes(value);
}

export function isExternalRequestType(value: unknown): value is ExternalRequestType {
  return typeof value === 'string' && (EXTERNAL_REQUEST_TYPES as readonly string[]).includes(value);
}

export function isExternalRequestStatus(value: unknown): value is ExternalRequestStatus {
  return typeof value === 'string' && (EXTERNAL_REQUEST_STATUSES as readonly string[]).includes(value);
}

export function toExternalRequestType(internal: RequestType): ExternalRequestType {
  switch (internal) {
    case 'renewal':
      return 'license_renewal';
    case 'capacity_increase':
      return 'plan_change';
    case 'agent_access':
      return 'additional_agent_access';
    case 'prepaid_credit':
      return 'token_credit';
    case 'license_support':
    case 'deployment_support':
    case 'general_support':
      return 'support';
    default: {
      const exhausted: never = internal;
      throw new IntegrationMappingError(`Unknown internal request type: ${String(exhausted)}`);
    }
  }
}

export function toExternalRequestStatus(internal: RequestStatus): ExternalRequestStatus {
  switch (internal) {
    case 'submitted':
      return 'submitted';
    case 'in_review':
      return 'under_review';
    case 'needs_information':
      return 'needs_information';
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    default: {
      const exhausted: never = internal;
      throw new IntegrationMappingError(`Unknown internal request status: ${String(exhausted)}`);
    }
  }
}

/** Maps one external type onto every internal type it covers (for list filters). */
export function fromExternalRequestType(external: ExternalRequestType): RequestType[] {
  switch (external) {
    case 'license_renewal':
      return ['renewal'];
    case 'plan_change':
      return ['capacity_increase'];
    case 'additional_agent_access':
      return ['agent_access'];
    case 'token_credit':
      return ['prepaid_credit'];
    case 'support':
      return ['license_support', 'deployment_support', 'general_support'];
    default: {
      const exhausted: never = external;
      throw new IntegrationMappingError(`Unknown external request type: ${String(exhausted)}`);
    }
  }
}

export function fromExternalRequestStatus(external: ExternalRequestStatus): RequestStatus {
  switch (external) {
    case 'submitted':
      return 'submitted';
    case 'under_review':
      return 'in_review';
    case 'needs_information':
      return 'needs_information';
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    default: {
      const exhausted: never = external;
      throw new IntegrationMappingError(`Unknown external request status: ${String(exhausted)}`);
    }
  }
}

export function requireInternalRequestType(value: string): RequestType {
  if (!isRequestType(value)) {
    throw new IntegrationMappingError(`Unknown internal request type: ${value}`);
  }
  return value;
}

export function requireInternalRequestStatus(value: string): RequestStatus {
  if (!(INTERNAL_REQUEST_STATUSES as readonly string[]).includes(value)) {
    throw new IntegrationMappingError(`Unknown internal request status: ${value}`);
  }
  return value as RequestStatus;
}
