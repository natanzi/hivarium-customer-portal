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
  UnavailableState,
  StatCard,
  StatusPill,
  formatDate,
  formatDateTime,
  formatTokens,
  modelLabel,
} from '../components/ui';

export default function Overview() {
  const state = useApi<OverviewData>(() => apiFetch('/api/v1/overview'), []);

  if (state.status === 'loading') {
    return (
      <Page title="Overview">
        <LoadingState label="Loading overview…" />
      </Page>
    );
  }
  if (state.status === 'error') {
    const expired = state.error.code === 'unauthorized';
    return (
      <Page title="Overview">
        <ErrorState
          message={
            expired
              ? 'Your portal session has expired. Sign in again to continue.'
              : state.error.message
          }
          onRetry={expired ? undefined : state.retry}
        />
      </Page>
    );
  }

  const data = state.data;
  const operatorAvailable = data.availability.operator === 'ok';
  const licenseAvailable = data.availability.license === 'ok';

  return (
    <Page
      eyebrow="Customer workspace"
      title="Overview"
      description={
        data.organization.name
          ? `A concise view of the ${data.organization.name} relationship with Hivarium.`
          : 'A concise view of your relationship with Hivarium.'
      }
      actions={
        <LinkButton to="/requests/new" className="hide-on-mobile">
          New request
        </LinkButton>
      }
    >
      {data.dataFreshness === 'unavailable' ? (
        <p className="hint-text" role="status">
          Operator Console data is not currently available. Request history below is from the portal.
        </p>
      ) : data.lastSynchronizedAt ? (
        <p className="hint-text" role="status">
          Last synchronized {formatDateTime(data.lastSynchronizedAt)} · live Operator Console data
        </p>
      ) : null}

      <div className="overview-grid">
        <Card title="Organization">
          {operatorAvailable ? (
            <DefList
              items={[
                { term: 'Organization', detail: data.organization.name ?? '—' },
                {
                  term: 'Account status',
                  detail: data.relationship.status ? <StatusPill status={data.relationship.status} /> : '—',
                },
                {
                  term: 'Commercial model',
                  detail: data.relationship.commercialModel ? modelLabel(data.relationship.commercialModel) : '—',
                },
                { term: 'Arrangement starts', detail: formatDate(data.relationship.effectiveDate) },
                { term: 'Arrangement ends', detail: formatDate(data.relationship.periodEnd) },
                { term: 'Renewal date', detail: formatDate(data.relationship.renewalDate) },
                {
                  term: 'Prepaid balance',
                  detail:
                    data.relationship.prepaidBalanceTokens !== null
                      ? `${formatTokens(data.relationship.prepaidBalanceTokens)} tokens`
                      : 'Not applicable',
                },
                { term: 'Enabled features', detail: data.featureCount ?? '—' },
              ]}
            />
          ) : (
            <UnavailableState title="Operator Service unavailable" message="Organization and commercial details could not be loaded. Retry after the Operator Console is reachable. This page does not invent substitute figures." />
          )}
          {operatorAvailable && data.relationship.lowBalance ? (
            <p className="warning-banner" role="status">
              Low prepaid balance: remaining tokens are at or below the warning threshold
              {data.relationship.warningThresholdTokens != null
                ? ` of ${formatTokens(data.relationship.warningThresholdTokens)}`
                : ''}
              .
            </p>
          ) : null}
        </Card>

        <Card title="Agents">
          {operatorAvailable ? (
            <DefList
              items={[
                { term: 'Active agents', detail: data.agentSummary.active ?? '—' },
                { term: 'Scheduled access changes', detail: data.agentSummary.scheduled ?? '—' },
              ]}
            />
          ) : (
            <UnavailableState title="Operator Service unavailable" message="Agent counts are not available until the Operator Console responds." />
          )}
        </Card>

        <Card title="Licenses">
          {licenseAvailable ? (
            <DefList
              items={[
                { term: 'Active licenses', detail: data.licenseSummary.activeLicenses ?? '—' },
                { term: 'Deployments', detail: data.licenseSummary.activeDeployments ?? '—' },
              ]}
            />
          ) : (
            <UnavailableState title="License Service unavailable" message="License summary is not available until the License Service responds." />
          )}
        </Card>

        <Card
          title="Recent requests"
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
            <EmptyState message="No customer-visible request activity yet." />
          )}
        </Card>
      </div>
    </Page>
  );
}
