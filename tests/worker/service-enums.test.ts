import { describe, it, expect } from 'vitest';
import type { RequestStatus, RequestType } from '../../shared/types';
import {
  fromExternalRequestStatus,
  fromExternalRequestType,
  IntegrationMappingError,
  requireInternalRequestStatus,
  requireInternalRequestType,
  toExternalRequestStatus,
  toExternalRequestType,
} from '../../worker/domain/service-enums';

const TYPE_PAIRS: Array<[RequestType, ReturnType<typeof toExternalRequestType>]> = [
  ['renewal', 'license_renewal'],
  ['capacity_increase', 'plan_change'],
  ['agent_access', 'additional_agent_access'],
  ['prepaid_credit', 'token_credit'],
  ['license_support', 'support'],
  ['deployment_support', 'support'],
  ['general_support', 'support'],
];

const STATUS_PAIRS: Array<[RequestStatus, ReturnType<typeof toExternalRequestStatus>]> = [
  ['submitted', 'submitted'],
  ['in_review', 'under_review'],
  ['needs_information', 'needs_information'],
  ['approved', 'approved'],
  ['rejected', 'rejected'],
  ['completed', 'completed'],
  ['cancelled', 'cancelled'],
];

describe('service enum translation', () => {
  it('maps every internal request type onto exactly one external type', () => {
    for (const [internal, external] of TYPE_PAIRS) {
      expect(toExternalRequestType(internal)).toBe(external);
    }
  });

  it('maps every internal status onto exactly one external status', () => {
    for (const [internal, external] of STATUS_PAIRS) {
      expect(toExternalRequestStatus(internal)).toBe(external);
      expect(fromExternalRequestStatus(external)).toBe(internal);
    }
  });

  it('expands external support onto the three internal support types', () => {
    expect(fromExternalRequestType('support')).toEqual([
      'license_support',
      'deployment_support',
      'general_support',
    ]);
    expect(fromExternalRequestType('license_renewal')).toEqual(['renewal']);
  });

  it('rejects unknown internal values with a controlled error', () => {
    expect(() => requireInternalRequestType('refund')).toThrow(IntegrationMappingError);
    expect(() => requireInternalRequestStatus('queued')).toThrow(IntegrationMappingError);
  });
});
