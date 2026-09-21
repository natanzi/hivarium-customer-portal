import { useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../lib/useApi';
import { apiFetch, ApiError } from '../api/client';
import type { DeploymentRecord, LicenseRecord, LicensesData } from '../../shared/types';
import {
  Button,
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
  'self-hosted': 'Self-hosted',
  'managed-cloud': 'Managed cloud',
  'air-gapped': 'Air-gapped',
  embedded: 'Embedded',
};

export async function downloadSignedLicense(licenseId: string): Promise<void> {
  const response = await fetch(`/api/v1/licenses/${encodeURIComponent(licenseId)}/document`, {
    credentials: 'same-origin',
    headers: { Accept: '*/*' },
  });
  if (!response.ok) {
    let message = 'The signed license document could not be retrieved.';
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      /* keep default */
    }
    throw new ApiError(response.status, 'upstream_unavailable', message);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition');
  const match = disposition?.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] ?? `license-${licenseId}.json`;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export function LicenseFields({ license }: { license: LicenseRecord }) {
  const activations = license.deployments.reduce((sum, d) => sum + d.activationCount, 0);
  const limits = license.deployments
    .map((d) => d.activationLimit)
    .filter((value): value is number => value !== null);
  return (
    <DefList
      items={[
        { term: 'Product', detail: license.product ?? license.licenseType },
        { term: 'License ID', detail: <span className="mono-id">{license.id}</span> },
        { term: 'Status', detail: <StatusPill status={license.status} /> },
        { term: 'Revision', detail: license.revision ?? '—' },
        {
          term: 'Deployment type',
          detail: license.deployments[0] ? MODE_LABELS[license.deployments[0].mode] ?? license.deployments[0].mode : '—',
        },
        { term: 'Valid from', detail: formatDate(license.issuedAt) },
        { term: 'Valid until', detail: formatDate(license.expiresAt) },
        {
          term: 'Entitlement limits',
          detail:
            license.permittedAgentProducts.length > 0 ? license.permittedAgentProducts.join(', ') : '—',
        },
        {
          term: 'Activation summary',
          detail:
            limits.length > 0 ? `${activations} of ${limits.reduce((a, b) => a + b, 0)} activations used` : `${activations} activations`,
        },
      ]}
    />
  );
}

function DeploymentsTable({ deployments }: { deployments: DeploymentRecord[] }) {
  if (deployments.length === 0) return null;
  return (
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
          {deployments.map((deployment) => (
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
  );
}

export function LicenseActions({
  licenseId,
  onError,
  showDetailsLink = true,
}: {
  licenseId: string;
  onError: (message: string) => void;
  showDetailsLink?: boolean;
}) {
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    onError('');
    try {
      await downloadSignedLicense(licenseId);
    } catch (error) {
      onError(error instanceof ApiError ? error.message : 'The signed license document could not be retrieved.');
    } finally {
      setDownloading(false);
    }
  };
  return (
    <div className="action-row">
      {showDetailsLink ? (
        <LinkButton to={`/licenses/${encodeURIComponent(licenseId)}`} variant="secondary">
          View details
        </LinkButton>
      ) : (
        <LinkButton to="/licenses" variant="ghost">
          Back to licenses
        </LinkButton>
      )}
      <Button variant="secondary" onClick={() => void download()} disabled={downloading}>
        {downloading ? 'Downloading…' : 'Download signed license'}
      </Button>
      <LinkButton to={`/requests/new?type=renewal&license=${encodeURIComponent(licenseId)}`}>
        Request renewal
      </LinkButton>
    </div>
  );
}

function LicenseCard({ license }: { license: LicenseRecord }) {
  const [error, setError] = useState('');
  return (
    <Card title={license.product ?? license.licenseType} actions={<StatusPill status={license.status} />}>
      <p className="mono-id" aria-label="License identifier">
        {license.id}
      </p>
      <LicenseFields license={license} />
      <DeploymentsTable deployments={license.deployments} />
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <LicenseActions licenseId={license.id} onError={setError} />
    </Card>
  );
}

export default function Licenses() {
  const state = useApi<LicensesData>(() => apiFetch('/api/v1/licenses'), []);

  if (state.status === 'loading') return <Page title="Licenses"><LoadingState /></Page>;
  if (state.status === 'error') {
    return (
      <Page title="Licenses">
        <ErrorState message={state.error.message} onRetry={state.retry} />
      </Page>
    );
  }

  const { licenses } = state.data;

  return (
    <Page
      eyebrow="Entitlements"
      title="Licenses"
      description="Signed licenses for your organization. Customers can view and download documents and request renewal; issuance, suspension, and revocation stay with Hivarium operators."
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
