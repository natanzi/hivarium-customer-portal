/**
 * Operator Console → Customer Portal inbound service contract shapes.
 * These types are not used by the customer SPA.
 */

/** Canonical Operator Console DTO names — not D1 storage names. */
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

export const OPERATOR_SERVICE_API_VERSION = '1';

export interface OperatorSubmittedBy {
  displayName: string;
  email: string;
}

export interface OperatorRequestSummary {
  requestId: string;
  customerId: string;
  requestType: ExternalRequestType;
  status: ExternalRequestStatus;
  summary: string;
  submittedBy: OperatorSubmittedBy;
  createdAt: string;
  updatedAt: string;
}

export interface OperatorRequestEvent {
  eventId: string;
  requestId: string;
  previousStatus: ExternalRequestStatus | null;
  resultingStatus: ExternalRequestStatus | null;
  eventType: string;
  occurredAt: string;
  principalType: string;
  principalIdentifier: string;
  idempotencyKeyHash: string | null;
  externalReference: string | null;
  customerVisibleMessage: string;
  operatorNote: string | null;
}

export interface OperatorRequestDetail extends OperatorRequestSummary {
  title: string;
  reason: string;
  payload: Record<string, unknown>;
  cancelledAt: string | null;
  completedAt: string | null;
  events: OperatorRequestEvent[];
}

export interface OperatorRequestListResponse {
  apiVersion: typeof OPERATOR_SERVICE_API_VERSION;
  items: OperatorRequestSummary[];
  nextCursor: string | null;
}

export interface OperatorRequestDetailResponse {
  apiVersion: typeof OPERATOR_SERVICE_API_VERSION;
  request: OperatorRequestDetail;
}

export interface OperatorDecisionResponse {
  apiVersion: typeof OPERATOR_SERVICE_API_VERSION;
  request: OperatorRequestDetail;
  replayed: boolean;
}
