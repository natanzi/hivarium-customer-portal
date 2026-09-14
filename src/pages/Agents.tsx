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
    { term: 'Access', detail: grant.status },
    { term: 'Starts', detail: formatDate(grant.startsAt) },
    { term: 'Ends', detail: formatDate(grant.endsAt) },
  ];
  if (grant.licenseId) fields.push({ term: 'License', detail: grant.licenseId });
  if (grant.deploymentId) fields.push({ term: 'Deployment', detail: grant.deploymentId });
  return fields;
}

function AgentCard({ grant }: { grant: AgentAccessGrant }) {
  return (
    <Card
      title={grant.agentName}
      actions={<StatusPill status={grant.status} />}
    >
      <DefList
        items={[
          ...(grant.category ? [{ term: 'Category', detail: grant.category }] : []),
          ...(grant.version ? [{ term: 'Version', detail: grant.version }] : []),
          ...grantFields(grant),
        ]}
      />
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
  const catalogNames = new Map(catalog.map((p) => [p.id, p.name]));
  const accessibleIds = new Set([...access.current, ...access.scheduled].map((g) => g.agentProductId));
  const availableButNotGranted = catalog.filter((p) => !accessibleIds.has(p.id));

  return (
    <Page
      eyebrow="Agent access"
      title="Agents"
      description="The Hivarium agents your organization is permitted to use. Access is granted by Hivarium operators — this portal only shows what is authorized."
      actions={
        <LinkButton to="/requests/new?type=agent_access" className="hide-on-mobile">
          Request agent access
        </LinkButton>
      }
    >
      <Card title="Current access">
        {access.current.length > 0 ? (
          <div className="card-grid">
            {access.current.map((grant) => (
              <AgentCard key={grant.grantId} grant={grant} />
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
              <AgentCard key={grant.grantId} grant={grant} />
            ))}
          </div>
        </Card>
      ) : null}

      {availableButNotGranted.length > 0 ? (
        <Card
          title="Available on request"
          actions={
            <LinkButton to="/requests/new?type=agent_access" variant="secondary">
              Request access
            </LinkButton>
          }
        >
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
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {catalog.length === 0 ? (
        <p className="hint-text text-faint" aria-label="Catalog note">
          {catalogNames.size === 0 ? 'Agent catalog information is currently unavailable.' : ''}
        </p>
      ) : null}
    </Page>
  );
}