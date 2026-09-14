/**
 * Request lifecycle rules for operator decisions and customer cancellation.
 *
 * Canonical portal status names are used (`in_review`, not `under_review`).
 * Operator Console maps `under_review` → `in_review`. Cancellation is only
 * valid through the existing customer-authorized flow (submitted → cancelled).
 * Customer submission never mutates commercial, balance, agent, or license state.
 */

import type { RequestStatus } from '../../shared/types';

export const REQUEST_STATUSES: readonly RequestStatus[] = [
  'submitted',
  'in_review',
  'needs_information',
  'approved',
  'rejected',
  'completed',
  'cancelled',
] as const;

export const TERMINAL_STATUSES: readonly RequestStatus[] = ['rejected', 'completed', 'cancelled'];

/** Operator decision values accepted on POST /service/v1/requests/:id/decision. */
export type OperatorDecision = 'under_review' | 'approved' | 'rejected' | 'needs_information' | 'completed';

export const OPERATOR_DECISIONS: readonly OperatorDecision[] = [
  'under_review',
  'approved',
  'rejected',
  'needs_information',
  'completed',
] as const;

const OPERATOR_ALLOWED: Record<RequestStatus, readonly RequestStatus[]> = {
  submitted: ['in_review', 'approved', 'rejected', 'needs_information'],
  in_review: ['approved', 'rejected', 'needs_information'],
  needs_information: ['in_review'],
  approved: ['completed'],
  rejected: [],
  completed: [],
  cancelled: [],
};

export function isRequestStatus(value: unknown): value is RequestStatus {
  return typeof value === 'string' && (REQUEST_STATUSES as readonly string[]).includes(value);
}

export function isOperatorDecision(value: unknown): value is OperatorDecision {
  return typeof value === 'string' && (OPERATOR_DECISIONS as readonly string[]).includes(value);
}

export function isTerminalStatus(status: RequestStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** Maps an operator decision onto the portal status stored in D1. */
export function statusForDecision(decision: OperatorDecision): RequestStatus {
  return decision === 'under_review' ? 'in_review' : decision;
}

export function canOperatorTransition(from: RequestStatus, to: RequestStatus): boolean {
  return OPERATOR_ALLOWED[from].includes(to);
}

/** Existing customer cancellation: only a submitted request may be cancelled. */
export function canCustomerCancel(from: RequestStatus): boolean {
  return from === 'submitted';
}

/** Customer comment on needs_information resubmits the request into review. */
export function canCustomerResubmit(from: RequestStatus): boolean {
  return from === 'needs_information';
}

export function assertOperatorTransition(from: RequestStatus, to: RequestStatus): void {
  if (!canOperatorTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export class InvalidTransitionError extends Error {
  readonly from: RequestStatus;
  readonly to: RequestStatus;
  constructor(from: RequestStatus, to: RequestStatus) {
    super(`Cannot transition from ${from} to ${to}.`);
    this.from = from;
    this.to = to;
  }
}
