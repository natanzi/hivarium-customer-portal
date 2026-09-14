/**
 * Shared UI primitives and state surfaces.
 *
 * Every data state has a distinct, labeled surface: loading (skeleton with
 * aria-busy), empty, error (with retry), unavailable (service-boundary) and
 * unauthorized. Status is never conveyed by color alone — pills always carry
 * a text label.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { ApiError } from '../api/client';
import type { RequestStatus } from '../../shared/types';

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

export function Page({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1>{title}</h1>
          {description ? <p className="page-lede">{description}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  className = '',
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`.trim()} aria-label={title}>
      {title || actions ? (
        <header className="card-header">
          {title ? <h2>{title}</h2> : null}
          {actions ? <div className="card-actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function StatCard({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {detail ? <p className="stat-detail">{detail}</p> : null}
    </div>
  );
}

export function DefList({ items }: { items: Array<{ term: string; detail: ReactNode }> }) {
  return (
    <dl className="def-list">
      {items.map((item) => (
        <div className="def-row" key={item.term}>
          <dt>{item.term}</dt>
          <dd>{item.detail ?? <span className="text-faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Status pill (text-based; color is redundant, never the only cue)
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  in_review: 'In review',
  approved: 'Approved',
  rejected: 'Rejected',
  completed: 'Completed',
  cancelled: 'Cancelled',
  active: 'Active',
  scheduled: 'Scheduled',
  expired: 'Expired',
  revoked: 'Revoked',
  disabled: 'Disabled',
  archived: 'Archived',
  pending: 'Pending',
  ended: 'Ended',
};

export function StatusPill({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span className={`status-pill status-${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Buttons and links
// ---------------------------------------------------------------------------

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`btn btn-${variant} ${className}`.trim()}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  children,
  variant = 'primary',
  className = '',
}: {
  to: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  className?: string;
}) {
  return (
    <Link to={to} className={`btn btn-${variant} ${className}`.trim()}>
      {children}
    </Link>
  );
}

export function OutboundLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="btn btn-secondary">
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------
// State surfaces
// ---------------------------------------------------------------------------

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state-surface" role="status" aria-busy="true" aria-live="polite" aria-label={label}>
      <span className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-surface" role="alert">
      <p className="state-title">Something went wrong</p>
      <p>{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function UnavailableState({
  title = 'Section temporarily unavailable',
  message = 'This information could not be loaded right now. It will reappear as soon as the underlying service is reachable.',
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="state-surface state-unavailable" role="status">
      <p className="state-title">{title}</p>
      <p>{message}</p>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="state-surface state-empty" role="status">
      <p>{message}</p>
    </div>
  );
}

export function SectionUnavailable({ label }: { label: string }) {
  return (
    <Card title={label}>
      <UnavailableState message="This section depends on an internal Hivarium service that is not reachable right now. Please try again later." />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function errorMessage(error: ApiError): string {
  return error.message;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString();
}

export function modelLabel(model: string): string {
  const labels: Record<string, string> = {
    monthly_subscription: 'Monthly subscription',
    annual_contract: 'Annual contract',
    prepaid_tokens: 'Prepaid tokens',
    negotiated_agreement: 'Negotiated agreement',
    bare_metal_agreement: 'Bare-metal agreement',
  };
  return labels[model] ?? model;
}