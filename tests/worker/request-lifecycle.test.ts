import { describe, it, expect } from 'vitest';
import type { RequestStatus } from '../../shared/types';
import {
  REQUEST_STATUSES,
  TERMINAL_STATUSES,
  canCustomerCancel,
  canCustomerResubmit,
  canOperatorTransition,
  isTerminalStatus,
  statusForDecision,
  type OperatorDecision,
} from '../../worker/domain/request-lifecycle';

const ALLOWED: Array<[RequestStatus, RequestStatus]> = [
  ['submitted', 'in_review'],
  ['submitted', 'approved'],
  ['submitted', 'rejected'],
  ['submitted', 'needs_information'],
  ['in_review', 'approved'],
  ['in_review', 'rejected'],
  ['in_review', 'needs_information'],
  ['needs_information', 'in_review'],
  ['approved', 'completed'],
];

describe('operator lifecycle transitions', () => {
  it('allows every documented operator transition', () => {
    for (const [from, to] of ALLOWED) {
      expect(canOperatorTransition(from, to), `${from} → ${to}`).toBe(true);
    }
  });

  it('rejects every undocumented operator transition', () => {
    for (const from of REQUEST_STATUSES) {
      for (const to of REQUEST_STATUSES) {
        const allowed = ALLOWED.some((pair) => pair[0] === from && pair[1] === to);
        expect(canOperatorTransition(from, to), `${from} → ${to}`).toBe(allowed);
      }
    }
  });

  it('protects terminal states from any operator transition', () => {
    for (const terminal of TERMINAL_STATUSES) {
      expect(isTerminalStatus(terminal)).toBe(true);
      for (const to of REQUEST_STATUSES) {
        expect(canOperatorTransition(terminal, to), `${terminal} → ${to}`).toBe(false);
      }
    }
  });

  it('treats approved and completed as distinct', () => {
    expect(canOperatorTransition('approved', 'completed')).toBe(true);
    expect(canOperatorTransition('completed', 'approved')).toBe(false);
    expect(canOperatorTransition('submitted', 'completed')).toBe(false);
    expect(statusForDecision('approved')).toBe('approved');
    expect(statusForDecision('completed')).toBe('completed');
    expect(statusForDecision('under_review')).toBe('in_review');
  });

  it('maps each operator decision onto the canonical portal status', () => {
    const decisions: OperatorDecision[] = [
      'under_review',
      'approved',
      'rejected',
      'needs_information',
      'completed',
    ];
    expect(decisions.map(statusForDecision)).toEqual([
      'in_review',
      'approved',
      'rejected',
      'needs_information',
      'completed',
    ]);
  });

  it('restricts customer cancellation to submitted requests', () => {
    for (const status of REQUEST_STATUSES) {
      expect(canCustomerCancel(status)).toBe(status === 'submitted');
    }
  });

  it('allows customer resubmission only from needs_information', () => {
    for (const status of REQUEST_STATUSES) {
      expect(canCustomerResubmit(status)).toBe(status === 'needs_information');
    }
  });
});
