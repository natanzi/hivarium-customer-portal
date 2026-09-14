import { Link } from 'react-router';
import { useApi } from '../lib/useApi';
import { apiFetch } from '../api/client';
import type { OverviewData } from '../../shared/types';
import {
  Card,
  DefList,
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingState,
  Page,
  SectionUnavailable,
  StatCard,
  StatusPill,
  formatDate,
  formatTokens,
  modelLabel,
} from '../components/ui';

export default function Overview() {
  const state = useApi<OverviewData>(() => apiFetch('/api/v1/overview'), []);

  if (state.status === 'loading') return <Page title="Overview"><LoadingState /></Page>;
  if (state.status === 'error') {
    return (
      <Page title="Overview">
        <ErrorState message={state.error.message} onRetry={state.retry} />
      </Page>
    );
  }

  const data = state.data;
  const operatorAvailable = data.availability.operator === 'ok';
  const licenseAvailable = data.availability.license === 'ok';
  const nextAction = operatorAvailable
    ? {
        label: 'Submit a request',
        detail: 'Renewals, capacity, prepaid credit, agent access and support requests.',
        to: '/requests/new',
      }
    : {
        label: 'View your requests',
        detail: 'Track the status and history of requests you have submitted.',
        to: '/requests',
      };

  return (
    <Page
      eyebrow="Customer workspace"
      title="Relationship overview"
      description={
        data.organization.name
          ? `A concise view of your ${data.organization.name} relationship with Hivarium.`
          : 'A concise view of your relationship with Hivarium.'
      }
      actions={
        <LinkButton to="/requests/new" className="hide-on-mobile">
          New request
        </LinkButton>
      }
    >
      <div className="overview-grid">
        <Card title="Relationship">
          {operatorAvailable ? (
            <DefList
              items={[
                { term: 'Organization', detail: data.organization.name ?? '—' },
                { term: 'Status', detail: data.relationship.status ? <StatusPill status={data.relationship.status} /> : '—' },
                { term: 'Commercial model', detail: data.relationship.commercialModel ? modelLabel(data.relationship.commercialModel) : '—' },
                { term: 'Period ends', detail: formatDate(data.relationship.periodEnd) },
                {
                  term: 'Prepaid balance',
                  detail:
                    data.relationship.prepaidBalanceTokens !== null
                      ? `${formatTokens(data.relationship.prepaidBalanceTokens)} tokens`
                      : 'Not applicable',
                },
              ]}
            />
          ) : (
            <SectionUnavailable label="Relationship" />
          )}
        </Card>

        <Card title="Agents">
          {operatorAvailable ? (
            <DefList
              items={[
                { term: 'Active agents', detail: data.agentSummary.active ?? '—' },
                { term: 'Scheduled access', detail: data.agentSummary.scheduled ?? '—' },
              ]}
            />
          ) : (
            <SectionUnavailable label="Agents" />
          )}
        </Card>

        <Card title="Licenses & deployments">
          {licenseAvailable ? (
            <DefList
              items={[
                { term: 'Active licenses', detail: data.licenseSummary.activeLicenses ?? '—' },
                { term: 'Active deployments', detail: data.licenseSummary.activeDeployments ?? '—' },
              ]}
            />
          ) : (
            <SectionUnavailable label="Licenses" />
          )}
        </Card>

        <Card
          title="Requests"
          actions={
            <Link to="/requests" className="text-link">
              View all
            </Link>
          }
        >
          <StatCard label="Outstanding requests" value={data.requests.outstanding} />
          {data.requests.recent.length > 0 ? (
            <ul className="recent-list" aria-label="Recent requests">
              {data.requests.recent.map((request) => (
                <li key={request.id}>
                  <Link to={`/requests/${request.id}`} className="recent-row">
                    <span className="recent-title">{request.title}</span>
                    <StatusPill status={request.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message="No requests yet." />
          )}
        </Card>
      </div>

      <Card className="next-action-card">
        <div>
          <h2>{nextAction.label}</h2>
          <p>{nextAction.detail}</p>
        </div>
        <LinkButton to={nextAction.to} variant="secondary">
          {nextAction.label}
        </LinkButton>
      </Card>
    </Page>
  );
}