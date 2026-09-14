import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { useSession } from '../session';
import { useApi } from '../lib/useApi';
import { apiFetch, apiFetchJson, ApiError, newIdempotencyKey } from '../api/client';
import type { CustomerRequestDto, RequestType } from '../../shared/types';
import { REQUEST_TYPE_LABELS } from '../../shared/types';
import {
  Button,
  Card,
  DefList,
  ErrorState,
  LinkButton,
  LoadingState,
  Page,
  StatusPill,
  formatDateTime,
} from '../components/ui';

function payloadItems(request: CustomerRequestDto): Array<{ term: string; detail: string }> {
  const payload = request.payload;
  const items: Array<{ term: string; detail: string }> = [];
  for (const [key, value] of Object.entries(payload)) {
    if (value === '' || value === null || value === undefined) continue;
    items.push({ term: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), detail: String(value) });
  }
  return items;
}

const CANCEL_CONFIRM = 'Cancel this request? It cannot be undone.';

export default function RequestDetail() {
  const { requestId = '' } = useParams();
  const sessionState = useSession();
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const state = useApi<CustomerRequestDto>(() => apiFetch(`/api/v1/requests/${encodeURIComponent(requestId)}`), [requestId]);

  if (state.status === 'loading') return <Page title="Request"><LoadingState /></Page>;
  if (state.status === 'error') {
    return (
      <Page title="Request">
        <ErrorState message={state.error.message} onRetry={state.retry} />
      </Page>
    );
  }
  if (state.status !== 'ready') return null;

  const request = state.data;
  const session = sessionState.status === 'ready' ? sessionState.session : null;
  const isRequester =
    request && session ? request.requestedBy.membershipId === session.user.membershipId : false;
  const canCancel = request && session && request.status === 'submitted' && (session.capabilities.canCancel || isRequester);
  const canComment = request && session && session.capabilities.canComment && request.status !== 'cancelled';

  const cancel = async () => {
    if (!request) return;
    if (!window.confirm(CANCEL_CONFIRM)) return;
    setCancelling(true);
    setActionError(null);
    try {
      await apiFetchJson<{ request: CustomerRequestDto }>(`/api/v1/requests/${request.id}/cancel`, {});
      state.retry();
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : 'Cancellation failed. Please try again.');
      setCancelling(false);
    }
  };

  const submitComment = async (event: FormEvent) => {
    event.preventDefault();
    if (!request) return;
    if (comment.trim() === '') {
      setCommentError('Write a message first.');
      return;
    }
    setSubmittingComment(true);
    setCommentError(null);
    setActionError(null);
    try {
      await apiFetchJson<{ request: CustomerRequestDto }>(
        `/api/v1/requests/${request.id}/comments`,
        { message: comment.trim() },
        { headers: { 'Idempotency-Key': newIdempotencyKey() } },
      );
      setComment('');
      state.retry();
    } catch (error) {
      setCommentError(error instanceof ApiError ? error.message : 'The comment could not be added.');
    } finally {
      setSubmittingComment(false);
    }
  };

  return (
    <Page
      eyebrow={REQUEST_TYPE_LABELS[request.requestType as RequestType] ?? 'Request'}
      title={request.title}
      description={request.reason || undefined}
      actions={<StatusPill status={request.status} />}
    >
      <Card title="Details">
        <DefList
          items={[
            { term: 'Type', detail: REQUEST_TYPE_LABELS[request.requestType as RequestType] ?? request.requestType },
            { term: 'Status', detail: <StatusPill status={request.status} /> },
            { term: 'Submitted by', detail: `${request.requestedBy.displayName} (${request.requestedBy.email})` },
            { term: 'Submitted', detail: formatDateTime(request.createdAt) },
            ...(request.cancelledAt ? [{ term: 'Cancelled', detail: formatDateTime(request.cancelledAt) }] : []),
            ...(request.completedAt ? [{ term: 'Completed', detail: formatDateTime(request.completedAt) }] : []),
            ...payloadItems(request),
          ]}
        />
      </Card>

      {request.status === 'submitted' && canCancel ? (
        <Card title="Actions">
          <p className="hint-text">
            You can cancel this request while it is still in "submitted" state. Cancellation cannot be undone.
          </p>
          {actionError ? (
            <p className="field-error" role="alert">
              {actionError}
            </p>
          ) : null}
          <div className="action-row">
            <Button variant="danger" onClick={cancel} disabled={cancelling}>
              {cancelling ? 'Cancelling…' : 'Cancel request'}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card
        title="History"
        actions={
          <LinkButton to="/requests/new" variant="ghost">
            New request
          </LinkButton>
        }
      >
        <ol className="timeline" aria-label="Request history">
          {(request.events ?? []).map((event) => (
            <li key={event.id} className="timeline-item">
              <span className="timeline-marker" aria-hidden="true" />
              <div className="timeline-body">
                <p className="timeline-heading">
                  {event.actorLabel} · {event.message}
                </p>
                <p className="timeline-meta">{formatDateTime(event.createdAt)}</p>
                {event.eventType === 'comment' ? <p className="timeline-text">{event.message}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {canComment ? (
        <Card title="Add a comment">
          <form onSubmit={submitComment}>
            <div className="form-field">
              <label htmlFor="request-comment">Comment</label>
              <textarea
                id="request-comment"
                value={comment}
                onChange={(event) => {
                  setComment(event.target.value);
                  setCommentError(null);
                }}
                placeholder="Add context for the Hivarium team reviewing this request."
              />
              {commentError ? (
                <p className="field-error" role="alert">
                  {commentError}
                </p>
              ) : null}
            </div>
            <Button type="submit" disabled={submittingComment}>
              {submittingComment ? 'Posting…' : 'Post comment'}
            </Button>
          </form>
        </Card>
      ) : null}

      {!canCancel && request.status === 'submitted' && !isRequester && session ? (
        <p className="hint-text">Only the requester or a customer admin can cancel this request.</p>
      ) : null}
    </Page>
  );
}