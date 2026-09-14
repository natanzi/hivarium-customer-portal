/**
 * Shared API contract between the Customer Portal Worker and the browser SPA.
 * These types are intentionally plain data shapes that cross the same-origin
 * `/api/v1/*` boundary. They are also the payload shapes documented for
 * machine clients in `docs/machine-api.md`.
 */

// ---------------------------------------------------------------------------
// Identity, roles and capabilities
// ---------------------------------------------------------------------------

export type PortalRole =
  | 'customer_admin'
  | 'billing_viewer'
  | 'technical_operator'
  | 'read_only';

export type MembershipStatus = 'active' | 'disabled' | 'archived';

export interface Capabilities {
  /** Request types the authenticated actor is allowed to submit. */
  requestTypes: RequestType[];
  /** Whether the actor may cancel submitted requests. */
  canCancel: boolean;
  /** Whether the actor may add customer comments. */
  canComment: boolean;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type RequestType =
  | 'renewal'
  | 'capacity_increase'
  | 'prepaid_credit'
  | 'agent_access'
  | 'license_support'
  | 'deployment_support'
  | 'general_support';

export type RequestStatus =
  | 'submitted'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'cancelled';

export type RequestEventType =
  | 'created'
  | 'status_changed'
  | 'comment'
  | 'cancelled'
  | 'completed'
  | 'operator_note'
  | 'system';

export type ActorType = 'customer' | 'operator' | 'system';

export interface RequestPayloadMap {
  renewal: { desiredTerm?: 'monthly' | 'annual'; notes?: string };
  capacity_increase: { capacityType?: 'seats' | 'agents'; desiredCapacity: number; notes?: string };
  prepaid_credit: { amountTokens: number; notes?: string };
  agent_access: { agentProductId: string; purpose?: string; notes?: string };
  license_support: { licenseId?: string; issueDescription: string; notes?: string };
  deployment_support: { deploymentId?: string; environment?: string; issueDescription: string; notes?: string };
  general_support: { topic?: string; description: string; notes?: string };
}

export interface RequestEventDto {
  id: string;
  requestId: string;
  eventType: RequestEventType;
  actorType: ActorType;
  actorReference: string;
  actorLabel: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CustomerRequestDto {
  id: string;
  customerId: string;
  requestType: RequestType;
  status: RequestStatus;
  title: string;
  reason: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  completedAt: string | null;
  requestedBy: {
    membershipId: string;
    email: string;
    displayName: string;
  };
  /** Present only on detail responses. */
  events?: RequestEventDto[];
}

export interface CreateRequestInput {
  requestType: RequestType;
  /** Optional customer title; server falls back to the request-type label. */
  title?: string;
  reason?: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

export interface RequestListPage {
  requests: CustomerRequestDto[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  renewal: 'Renewal request',
  capacity_increase: 'Capacity increase',
  prepaid_credit: 'Prepaid credit',
  agent_access: 'Agent access',
  license_support: 'License support',
  deployment_support: 'Deployment support',
  general_support: 'General support',
};

// ---------------------------------------------------------------------------
// Commercial / operator-console derived data
// ---------------------------------------------------------------------------

export type CommercialModel =
  | 'monthly_subscription'
  | 'annual_contract'
  | 'prepaid_tokens'
  | 'negotiated_agreement'
  | 'bare_metal_agreement';

export interface CustomerProfile {
  customerId: string;
  name: string | null;
  status: string | null;
}

export interface CommercialArrangement {
  id: string;
  model: CommercialModel;
  status: string;
  effectiveDate: string;
  endDate: string | null;
  renewalDate: string | null;
  seatCapacity: number | null;
  agentCapacity: number | null;
  prepaidBalanceTokens: number | null;
  warningThresholdTokens: number | null;
  contractReference: string | null;
  deploymentModel: string | null;
  bareMetal: boolean;
  offlineAllowed: boolean;
}

export interface CommercialState {
  customerId: string;
  asOf: string;
  active: CommercialArrangement[];
  scheduled: CommercialArrangement[];
  history: CommercialArrangement[];
}

export interface AgentAccessGrant {
  grantId: string;
  agentProductId: string;
  agentName: string;
  category: string | null;
  version: string | null;
  status: 'active' | 'scheduled' | 'expired' | 'revoked';
  startsAt: string;
  endsAt: string | null;
  licenseId: string | null;
  deploymentId: string | null;
}

export interface AccessState {
  customerId: string;
  asOf: string;
  current: AgentAccessGrant[];
  scheduled: AgentAccessGrant[];
  history: AgentAccessGrant[];
}

export interface AgentProduct {
  id: string;
  name: string;
  category: string | null;
  version: string | null;
  description: string | null;
}

export type LedgerKind = 'credit_grant' | 'usage' | 'adjustment' | 'reversal';

export interface LedgerRow {
  transactionId: string;
  occurredAt: string;
  kind: LedgerKind;
  /** Positive for credits, negative for debits. */
  amountTokens: number;
  runningBalanceTokens: number;
  reference: string;
  reason: string | null;
  agentProductId: string | null;
  agentName: string | null;
}

export interface LedgerState {
  customerId: string;
  rows: LedgerRow[];
  balanceTokens: number;
  netTokensConsumed: number;
}

export interface UsageSummaryRow {
  agentProductId: string;
  agentName: string;
  tokensConsumed: number;
  usageCount: number;
}

export interface UsageSummary {
  customerId: string;
  rows: UsageSummaryRow[];
  netTokensConsumed: number;
}

export interface ActivityEventDto {
  id: string;
  occurredAt: string;
  type: string;
  message: string;
  actor: string | null;
}

// ---------------------------------------------------------------------------
// License service derived data
// ---------------------------------------------------------------------------

export interface DeploymentRecord {
  id: string;
  environment: string;
  mode: 'online' | 'offline' | 'bare_metal';
  lastValidatedAt: string | null;
  heartbeatAt: string | null;
  activationCount: number;
  activationLimit: number | null;
}

export interface LicenseRecord {
  id: string;
  licenseType: string;
  status: 'active' | 'expired' | 'revoked' | 'pending';
  issuedAt: string;
  expiresAt: string;
  permittedAgentProducts: string[];
  deployments: DeploymentRecord[];
}

export interface LicenseState {
  customerId: string;
  licenses: LicenseRecord[];
}

// ---------------------------------------------------------------------------
// API responses
// ---------------------------------------------------------------------------

export interface ApiErrorEnvelope {
  error: string;
  message: string;
  requestId?: string;
}

/** Operator / License service availability as seen by the portal. */
export interface ServiceAvailability {
  operator: 'ok' | 'unavailable' | 'missing';
  license: 'ok' | 'unavailable' | 'missing';
}

export interface SessionAccountStatus {
  auth: 'session';
  user: { membershipId: string; email: string; displayName: string; role: PortalRole };
  organization: { customerId: string; name: string | null };
  capabilities: Capabilities;
  signOutUrl: string;
}

export interface MachineAccountStatus {
  auth: 'machine';
  client: { id: string; name: string };
  organization: { customerId: string };
  scopes: string[];
  capabilities: Capabilities;
}

export type AccountStatus = SessionAccountStatus | MachineAccountStatus;

export interface OverviewData {
  organization: { customerId: string; name: string | null };
  relationship: {
    status: string | null;
    commercialModel: CommercialModel | null;
    periodEnd: string | null;
    prepaidBalanceTokens: number | null;
  };
  agentSummary: { active: number | null; scheduled: number | null };
  licenseSummary: { activeLicenses: number | null; activeDeployments: number | null };
  requests: { outstanding: number; recent: RecentRequestDto[] };
  availability: ServiceAvailability;
}

export interface RecentRequestDto {
  id: string;
  requestType: RequestType;
  status: RequestStatus;
  title: string;
  createdAt: string;
}

export interface SubscriptionData {
  commercial: CommercialState;
  availability: ServiceAvailability;
}

export interface AgentsData {
  access: AccessState;
  catalog: AgentProduct[];
  availability: ServiceAvailability;
}

export interface LicensesData {
  licenses: LicenseState;
  availability: ServiceAvailability;
}

export type UsageData =
  | {
      kind: 'prepaid';
      balanceTokens: number;
      warningThresholdTokens: number | null;
      ledger: LedgerRow[];
      availability: ServiceAvailability;
    }
  | {
      kind: 'commercial';
      model: CommercialModel;
      summary: UsageSummary;
      availability: ServiceAvailability;
    };

// ---------------------------------------------------------------------------
// Machine API scope names
// ---------------------------------------------------------------------------

export const MACHINE_SCOPES = [
  'account:read',
  'subscription:read',
  'licenses:read',
  'agents:read',
  'requests:read',
  'requests:write',
] as const;

export type MachineScope = (typeof MACHINE_SCOPES)[number];