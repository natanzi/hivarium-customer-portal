import { useApi } from '../lib/useApi';
import { apiFetch } from '../api/client';
import type { AgentAccessGrant, AgentsData } from '../../shared/types';
import {
  Card,
  DefList,
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingState,
  Page,
  StatusPill,
  formatDate,
} from '../components/ui';

function grantFields(grant: AgentAccessGrant): Array<{ term: string; detail: string }> {
  const fields: Array<{ term: string; detail: string }> = [
    { term: 'Product identifier', detail: grant.agentProductId },
    { term: 'Access state', detail: grant.status },
    { term: 'Active from', detail: formatDate(grant.startsAt) },
  ];
  if (grant.endsAt) fields.push({ term: 'Scheduled end', detail: formatDate(grant.endsAt) });
  if (grant.licenseId) fields.push({ term: 'Linked license', detail: grant.licenseId });
  if (grant.deploymentId) fields.push({ term: 'Deployment', detail: grant.deploymentId });
  if (grant.version) fields.push({ term: 'Version', detail: grant.version });
  return fields;
}

function AgentCard({ grant, changeHref }: { grant: AgentAccessGrant; changeHref: string }) {
  return (
    <Card
      title={grant.agentName}
      actions={<StatusPill status={grant.status} />}
    >
      <DefList
        items={[
          ...(grant.category ? [{ term: 'Category', detail: grant.category }] : []),
          ...grantFields(grant),
        ]}
      />
      <div className="action-row">
        <LinkButton to={changeHref} variant="secondary">
          Request access change
        </LinkButton>
      </div>
    </Card>
  );
}

export default function Agents() {
  const state = useApi<AgentsData>(() => apiFetch('/api/v1/agents'), []);

  if (state.status === 'loading') return <Page title="Agents"><LoadingState /></Page>;
  if (state.status === 'error') {
    return (
      <Page title="Agents">
        <ErrorState message={state.error.message} onRetry={state.retry} />
      </Page>
    );
  }

  const { access, catalog } = state.data;
  const accessibleIds = new Set([...access.current, ...access.scheduled].map((g) => g.agentProductId));
  const availableButNotGranted = catalog.filter((p) => !accessibleIds.has(p.id));

  return (
    <Page
      eyebrow="Agent access"
      title="Agents"
      description="Agents authorized for your organization. Access changes are submitted as requests; this portal never grants or revokes access itself."
      actions={
        <LinkButton to="/requests/new?type=agent_access">
          Request additional agent access
        </LinkButton>
      }
    >
      <Card title="Current access">
        {access.current.length > 0 ? (
          <div className="card-grid">
            {access.current.map((grant) => (
              <AgentCard
                key={grant.grantId}
                grant={grant}
                changeHref={`/requests/new?type=agent_access&agent=${encodeURIComponent(grant.agentProductId)}`}
              />
            ))}
          </div>
        ) : (
          <EmptyState message="No agents are currently authorized for your organization." />
        )}
      </Card>

      {access.scheduled.length > 0 ? (
        <Card title="Scheduled access">
          <div className="card-grid">
            {access.scheduled.map((grant) => (
              <AgentCard
                key={grant.grantId}
                grant={grant}
                changeHref={`/requests/new?type=agent_access&agent=${encodeURIComponent(grant.agentProductId)}`}
              />
            ))}
          </div>
        </Card>
      ) : null}

      {availableButNotGranted.length > 0 ? (
        <Card title="Available on request">
          <ul className="plain-list">
            {availableButNotGranted.map((product) => (
              <li key={product.id} className="plain-row">
                <div>
                  <p className="plain-title">
                    {product.name} {product.version ? <span className="text-faint">v{product.version}</span> : null}
                  </p>
                  <p className="text-faint">
                    {product.category ? `${product.category} — ` : ''}
                    {product.description ?? 'No description available.'}
                  </p>
                  <p className="mono-id">{product.id}</p>
                </div>
                <LinkButton to={`/requests/new?type=agent_access&agent=${encodeURIComponent(product.id)}`} variant="secondary">
                  Request additional agent access
                </LinkButton>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </Page>
  );
}
