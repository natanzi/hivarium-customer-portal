import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useSession } from '../session';
import { apiFetchJson, ApiError, newIdempotencyKey } from '../api/client';
import type { CustomerRequestDto, RequestType } from '../../shared/types';
import { REQUEST_TYPE_LABELS } from '../../shared/types';
import { Button, Card, Page } from '../components/ui';

interface FormState {
  title: string;
  reason: string;
  payload: Record<string, string>;
}

const TYPE_FIELDS: Partial<
  Record<
    RequestType,
    Array<{
      key: string;
      label: string;
      type: 'text' | 'number' | 'select' | 'textarea' | 'date';
      required?: boolean;
      options?: string[];
      placeholder?: string;
    }>
  >
> = {
  renewal: [
    { key: 'licenseId', label: 'Selected license', type: 'text', required: true, placeholder: 'License ID' },
    { key: 'desiredTerm', label: 'Requested duration', type: 'select', options: ['monthly', 'annual'] },
    { key: 'notes', label: 'Renewal note', type: 'textarea', placeholder: 'Anything we should know about the renewal.' },
  ],
  capacity_increase: [
    { key: 'currentPlan', label: 'Current plan', type: 'text' },
    { key: 'requestedPlan', label: 'Requested plan or requirements', type: 'textarea', required: true },
    { key: 'effectiveDatePreference', label: 'Effective-date preference', type: 'text', placeholder: 'e.g. start of next quarter' },
    { key: 'notes', label: 'Note', type: 'textarea' },
  ],
  prepaid_credit: [
    { key: 'amountTokens', label: 'Requested token amount', type: 'number', required: true },
    { key: 'notes', label: 'Reason', type: 'textarea', required: true },
    { key: 'urgency', label: 'Urgency', type: 'select', options: ['low', 'normal', 'high'] },
  ],
  agent_access: [
    { key: 'agentProductId', label: 'Requested agent', type: 'text', required: true, placeholder: 'e.g. agent-scan-001' },
    { key: 'purpose', label: 'Intended use case', type: 'textarea', required: true },
    { key: 'startDate', label: 'Requested start date', type: 'date' },
    { key: 'notes', label: 'Note', type: 'textarea' },
  ],
  license_support: [
    { key: 'licenseId', label: 'License id (if known)', type: 'text' },
    { key: 'issueDescription', label: 'Describe the issue', type: 'textarea', required: true },
  ],
  deployment_support: [
    { key: 'deploymentId', label: 'Deployment id (if known)', type: 'text' },
    { key: 'environment', label: 'Environment', type: 'text', placeholder: 'e.g. production' },
    { key: 'issueDescription', label: 'Describe the issue', type: 'textarea', required: true },
  ],
  general_support: [
    { key: 'subject', label: 'Subject', type: 'text', required: true },
    { key: 'description', label: 'Description', type: 'textarea', required: true },
    { key: 'severity', label: 'Severity', type: 'select', options: ['low', 'normal', 'high', 'urgent'] },
  ],
};

const NUMBER_KEYS = new Set(['desiredCapacity', 'amountTokens']);

const QUERY_TYPE_ALIASES: Record<string, RequestType> = {
  license_renewal: 'renewal',
  plan_change: 'capacity_increase',
  additional_agent_access: 'agent_access',
  token_credit: 'prepaid_credit',
  support: 'general_support',
  renewal: 'renewal',
  capacity_increase: 'capacity_increase',
  agent_access: 'agent_access',
  prepaid_credit: 'prepaid_credit',
  general_support: 'general_support',
  license_support: 'license_support',
  deployment_support: 'deployment_support',
};

export default function RequestNew() {
  const sessionState = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const allowed = sessionState.status === 'ready' ? sessionState.session.capabilities.requestTypes : [];
  const rawType = searchParams.get('type');
  const mappedType = rawType ? QUERY_TYPE_ALIASES[rawType] : null;
  const preselected = mappedType && allowed.includes(mappedType) ? mappedType : null;
  const initialType = preselected ?? allowed[0] ?? null;
  const prefilled: Record<string, string> = {};
  const license = searchParams.get('license');
  const agent = searchParams.get('agent');
  if (license) prefilled.licenseId = license;
  if (agent) prefilled.agentProductId = agent;

  const [requestType, setRequestType] = useState<RequestType | null>(initialType);
  const [form, setForm] = useState<FormState>({ title: '', reason: '', payload: prefilled });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const idempotencyKey = useRef(newIdempotencyKey());

  const fields = requestType ? TYPE_FIELDS[requestType] ?? [] : [];

  const setField = (key: string, value: string) => {
    setForm((previous) => ({ ...previous, payload: { ...previous.payload, [key]: value } }));
    setFieldErrors((previous) => {
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!requestType || submitting) return;

    const errors: Record<string, string> = {};
    for (const field of fields) {
      const value = form.payload[field.key] ?? '';
      if (field.required && value.trim() === '') {
        errors[field.key] = 'This field is required.';
      }
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      const value = form.payload[field.key]?.trim() ?? '';
      if (value === '') continue;
      payload[field.key] = NUMBER_KEYS.has(field.key) ? Number(value) : value;
    }
    if (form.reason.trim()) payload.notes = payload.notes ?? form.reason.trim();

    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await apiFetchJson<{ request: CustomerRequestDto; replayed: boolean }>(
        '/api/v1/requests',
        {
          requestType,
          title: form.title.trim() || undefined,
          reason: form.reason.trim() || (typeof payload.notes === 'string' ? payload.notes : undefined),
      payload,
      idempotencyKey: idempotencyKey.current,
        },
      );
      setCreatedId(result.request.id);
      navigate(`/requests/${result.request.id}`, { replace: true, state: { justCreated: true } });
    } catch (error) {
      if (error instanceof ApiError) {
        setSubmitError(error.message);
      } else {
        setSubmitError('The request could not be submitted. Please try again.');
      }
      setSubmitting(false);
    }
  };

  const payloadSummary = useMemo(() => {
    if (!requestType) return null;
    const meaningful = Object.entries(form.payload)
      .filter(([, value]) => value.trim() !== '')
      .map(([key, value]) => `${key}: ${value}`);
    return meaningful.length > 0 ? meaningful.join(' · ') : 'No additional details.';
  }, [form.payload, requestType]);

  if (allowed.length === 0) {
    return (
      <Page title="New request">
        <Card title="Not allowed">
          <p className="text-faint">Your role does not allow submitting requests.</p>
        </Card>
      </Page>
    );
  }

  return (
    <Page
      eyebrow="Service requests"
      title="New request"
      description="Describe what you need. Hivarium operators review every request before anything changes — nothing happens automatically."
    >
      {createdId ? (
        <p className="hint-text" role="status">
          Request {createdId} submitted.
        </p>
      ) : null}
      <form onSubmit={submit} noValidate>
        <Card title="Request details">
          <div className="form-field">
            <label htmlFor="request-type">Request type</label>
            <select
              id="request-type"
              value={requestType ?? ''}
              onChange={(event) => {
                setRequestType(event.target.value as RequestType);
                setForm({ title: '', reason: '', payload: {} });
                setFieldErrors({});
                idempotencyKey.current = newIdempotencyKey();
              }}
            >
              {allowed.map((type) => (
                <option key={type} value={type}>
                  {REQUEST_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label htmlFor="request-title">Title (optional)</label>
            <input
              id="request-title"
              type="text"
              maxLength={120}
              value={form.title}
              onChange={(event) => setForm((previous) => ({ ...previous, title: event.target.value }))}
              placeholder="A short label for your request"
            />
          </div>

          {fields.map((field) => (
            <div className="form-field" key={field.key}>
              <label htmlFor={`field-${field.key}`}>
                {field.label}
                {field.required ? ' *' : ''}
              </label>
              {field.type === 'select' ? (
                <select
                  id={`field-${field.key}`}
                  value={form.payload[field.key] ?? ''}
                  onChange={(event) => setField(field.key, event.target.value)}
                >
                  <option value="">Select…</option>
                  {field.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea
                  id={`field-${field.key}`}
                  value={form.payload[field.key] ?? ''}
                  onChange={(event) => setField(field.key, event.target.value)}
                  placeholder={field.placeholder}
                />
              ) : (
                <input
                  id={`field-${field.key}`}
                  type={field.type}
                  min={field.type === 'number' ? 1 : undefined}
                  value={form.payload[field.key] ?? ''}
                  onChange={(event) => setField(field.key, event.target.value)}
                  placeholder={field.placeholder}
                />
              )}
              {fieldErrors[field.key] ? (
                <p className="field-error" role="alert">
                  {fieldErrors[field.key]}
                </p>
              ) : null}
            </div>
          ))}

          <div className="form-field">
            <label htmlFor="request-reason">Business reason (optional)</label>
            <textarea
              id="request-reason"
              value={form.reason}
              onChange={(event) => setForm((previous) => ({ ...previous, reason: event.target.value }))}
              placeholder="Why is this needed?"
            />
          </div>

          <p className="form-note" aria-live="polite">
            Summary: {payloadSummary}
          </p>

          {submitError ? (
            <p className="field-error" role="alert">
              {submitError}
            </p>
          ) : null}

          <div className="form-actions">
            <Button type="submit" disabled={submitting || !requestType}>
              {submitting ? 'Submitting…' : 'Submit request'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate('/requests')}>
              Cancel
            </Button>
          </div>
        </Card>
      </form>
    </Page>
  );
}
