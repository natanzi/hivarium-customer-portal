import { useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../lib/useApi';
import { apiFetch } from '../api/client';
import type { RequestListPage, RequestStatus } from '../../shared/types';
import { REQUEST_TYPE_LABELS } from '../../shared/types';
import {
  Button,
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingState,
  Page,
  StatusPill,
  formatDateTime,
} from '../components/ui';

const STATUS_FILTERS: Array<{ value: RequestStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'in_review', label: 'Under review' },
  { value: 'needs_information', label: 'Needs information' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function Requests() {
  const [status, setStatus] = useState<RequestStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (status !== 'all') query.set('status', status);
  const state = useApi<RequestListPage>(() => apiFetch(`/api/v1/requests?${query.toString()}`), [page, status]);

  if (state.status === 'loading') return <Page title="Requests"><LoadingState /></Page>;
  if (state.status === 'error') {
    return (
      <Page title="Requests">
        <ErrorState message={state.error.message} onRetry={state.retry} />
      </Page>
    );
  }

  const { requests, total, hasMore } = state.data;

  return (
    <Page
      eyebrow="Service requests"
      title="Requests"
      description="Requests you have submitted to Hivarium. Every change is reviewed by an operator — nothing happens automatically."
      actions={
        <LinkButton to="/requests/new" className="hide-on-mobile">
          New request
        </LinkButton>
      }
    >
      <div className="filter-bar" role="group" aria-label="Request filters">
        <label>
          Status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as RequestStatus | 'all');
              setPage(1);
            }}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="hint-text" style={{ alignSelf: 'center' }}>
          {total} request{total === 1 ? '' : 's'}
        </p>
      </div>

      {requests.length > 0 ? (
        <ul className="request-list" aria-label="Requests">
          {requests.map((request) => (
            <li key={request.id}>
              <Link to={`/requests/${request.id}`} className="request-row">
                <span className="request-main">
                  <span className="request-title">{request.title}</span>
                  <span className="request-meta">
                    {REQUEST_TYPE_LABELS[request.requestType]} · submitted {formatDateTime(request.createdAt)}
                  </span>
                </span>
                <StatusPill status={request.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState message="No requests match the current filter." />
      )}

      {hasMore || page > 1 ? (
        <div className="pager" aria-label="Request pages">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="pager-current">Page {page}</span>
          <Button variant="secondary" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </Page>
  );
}