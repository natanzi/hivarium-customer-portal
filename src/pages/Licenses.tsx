import { useApi } from '../lib/useApi';
import { apiFetch } from '../api/client';
import type { DeploymentRecord, LicenseRecord, LicensesData } from '../../shared/types';
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
  formatDateTime,
} from '../components/ui';

const MODE_LABELS: Record<string, string> = {
  online: 'Online',
  offline: 'Offline',
  bare_metal: 'Bare metal',
};

function LicenseCard({ license }: { license: LicenseRecord }) {
  return (
    <Card title={license.id} actions={<StatusPill status={license.status} />}>
      <DefList
        items={[
          { term: 'License type', detail: license.licenseType },
          { term: 'Issued', detail: formatDate(license.issuedAt) },
          { term: 'Expires', detail: formatDate(license.expiresAt) },
          {
            term: 'Permitted agents',
            detail:
              license.permittedAgentProducts.length > 0 ? license.permittedAgentProducts.join(', ') : '—',
          },
        ]}
      />
      {license.deployments.length > 0 ? (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="table-caption">Deployments</caption>
            <thead>
              <tr>
                <th scope="col">Deployment</th>
                <th scope="col">Environment</th>
                <th scope="col">Mode</th>
                <th scope="col">Last validation</th>
                <th scope="col">Activations</th>
              </tr>
            </thead>
            <tbody>
              {license.deployments.map((deployment: DeploymentRecord) => (
                <tr key={deployment.id}>
                  <td data-label="Deployment">{deployment.id}</td>
                  <td data-label="Environment">{deployment.environment}</td>
                  <td data-label="Mode">{MODE_LABELS[deployment.mode] ?? deployment.mode}</td>
                  <td data-label="Last validation">{formatDateTime(deployment.lastValidatedAt ?? deployment.heartbeatAt)}</td>
                  <td data-label="Activations">
                    {deployment.activationCount}
                    {deployment.activationLimit !== null ? ` / ${deployment.activationLimit}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

export default function Licenses() {
  const state = useApi<LicensesData>(() => apiFetch('/api/v1/licenses'), []);

  if (state.status === 'loading') return <Page title="Licenses & deployments"><LoadingState /></Page>;
  if (state.status === 'error') {
    return (
      <Page title="Licenses & deployments">
        <ErrorState message={state.error.message} onRetry={state.retry} />
      </Page>
    );
  }

  const { licenses } = state.data;

  return (
    <Page
      eyebrow="Entitlements"
      title="Licenses & deployments"
      description="Signed licenses issued for your organization and where they are deployed. Validation secrets are never shown here."
      actions={
        <LinkButton to="/requests/new?type=license_support" variant="secondary" >
          License support
        </LinkButton>
      }
    >
      {licenses.licenses.length > 0 ? (
        <div className="stack">
          {licenses.licenses.map((license) => (
            <LicenseCard key={license.id} license={license} />
          ))}
        </div>
      ) : (
        <Card title="Licenses">
          <EmptyState message="No licenses are recorded for your organization." />
        </Card>
      )}
    </Page>
  );
}