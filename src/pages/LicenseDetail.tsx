import { useState } from 'react';
import { useParams } from 'react-router';
import { useApi } from '../lib/useApi';
import { apiFetch } from '../api/client';
import type { LicenseRecord } from '../../shared/types';
import { Card, ErrorState, LinkButton, LoadingState, Page, StatusPill } from '../components/ui';
import { LicenseActions, LicenseFields } from './Licenses';

export default function LicenseDetail() {
  const { licenseId = '' } = useParams();
  const [downloadError, setDownloadError] = useState('');
  const state = useApi<LicenseRecord>(
    () => apiFetch(`/api/v1/licenses/${encodeURIComponent(licenseId)}`),
    [licenseId],
  );

  if (state.status === 'loading') return <Page title="License"><LoadingState /></Page>;
  if (state.status === 'error') {
    return (
      <Page title="License">
        <ErrorState message={state.error.message} onRetry={state.retry} />
        <LinkButton to="/licenses" variant="secondary">
          Back to licenses
        </LinkButton>
      </Page>
    );
  }

  const license = state.data;

  return (
    <Page
      eyebrow="License"
      title={license.product ?? license.licenseType}
      description="Customer-visible license record. Signing material is never shown."
      actions={<StatusPill status={license.status} />}
    >
      <Card title="Details">
        <LicenseFields license={license} />
        {downloadError ? (
          <p className="field-error" role="alert">
            {downloadError}
          </p>
        ) : null}
        <LicenseActions licenseId={license.id} onError={setDownloadError} showDetailsLink={false} />
      </Card>
    </Page>
  );
}
