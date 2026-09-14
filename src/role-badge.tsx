import type { PortalRole } from '../shared/types';

const ROLE_LABELS: Record<PortalRole, string> = {
  customer_admin: 'Customer admin',
  billing_viewer: 'Billing viewer',
  technical_operator: 'Technical operator',
  read_only: 'Read only',
};

export function RoleBadge({ role }: { role: PortalRole }) {
  return (
    <span className="role-badge">
      <span className="role-dot" aria-hidden="true" />
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}