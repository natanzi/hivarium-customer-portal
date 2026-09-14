/**
 * Server-side role and capability matrix.
 *
 * Capabilities are derived exclusively from the membership role stored in
 * PORTAL_DB. The browser never declares its own capabilities; this module is
 * the single source of truth for what an authenticated actor may do.
 */

import type { Capabilities, PortalRole, RequestType } from '../../shared/types';

const REQUEST_TYPE_ROLES: Record<RequestType, readonly PortalRole[]> = {
  renewal: ['customer_admin', 'billing_viewer'],
  capacity_increase: ['customer_admin', 'billing_viewer'],
  prepaid_credit: ['customer_admin', 'billing_viewer'],
  agent_access: ['customer_admin', 'technical_operator'],
  license_support: ['customer_admin', 'technical_operator'],
  deployment_support: ['customer_admin', 'technical_operator'],
  general_support: ['customer_admin', 'billing_viewer', 'technical_operator'],
};

const CAN_CANCEL_ROLES: readonly PortalRole[] = ['customer_admin'];
/** Roles that may cancel requests they personally submitted. */
const CAN_CANCEL_OWN_ROLES: readonly PortalRole[] = ['customer_admin', 'billing_viewer', 'technical_operator'];
const CAN_COMMENT_ROLES: readonly PortalRole[] = [
  'customer_admin',
  'billing_viewer',
  'technical_operator',
];

export function canSubmitRequestType(role: PortalRole, requestType: RequestType): boolean {
  return REQUEST_TYPE_ROLES[requestType].includes(role);
}

export function canCancelRequests(role: PortalRole): boolean {
  return CAN_CANCEL_ROLES.includes(role);
}

/** Whether the role may cancel a request it submitted itself (never read_only). */
export function canCancelOwnRequests(role: PortalRole): boolean {
  return CAN_CANCEL_OWN_ROLES.includes(role);
}

export function canCommentOnRequests(role: PortalRole): boolean {
  return CAN_COMMENT_ROLES.includes(role);
}

export function capabilitiesFor(role: PortalRole): Capabilities {
  const requestTypes = (Object.keys(REQUEST_TYPE_ROLES) as RequestType[]).filter((t) =>
    canSubmitRequestType(role, t),
  );
  return {
    requestTypes,
    canCancel: canCancelRequests(role),
    canComment: canCommentOnRequests(role),
  };
}