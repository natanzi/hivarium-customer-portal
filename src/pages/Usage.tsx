import { useMemo, useState } from 'react';
import { useApi } from '../lib/useApi';
import { apiFetch } from '../api/client';
import type { LedgerKind, LedgerRow, UsageData } from '../../shared/types';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Page,
  StatCard,
  formatDateTime,
  formatTokens,
} from '../components/ui';

const KIND_LABELS: Record<LedgerKind, string> = {
  credit_grant: 'Credit',
  usage: 'Usage',
  adjustment: 'Adjustment',
  reversal: 'Reversal',
};

function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function exportLedgerCsv(rows: LedgerRow[]): void {
  const header = ['Timestamp', 'Type', 'Tokens', 'Running balance', 'Reference', 'Reason', 'Agent'];
  const lines = rows.map((row) =>
    [
      row.occurredAt,
      row.kind,
      row.amountTokens,
      row.runningBalanceTokens,
      row.reference,
      row.reason ?? '',
      row.agentName ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  const blob = new Blob([[header.join(','), ...lines].join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `hivarium-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Usage() {
  const state = useApi<UsageData>(() => apiFetch('/api/v1/usage'), []);
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    if (state.status !== 'ready' || state.data.kind !== 'prepaid') return null;
    return state.data.ledger.filter(
      (row) =>
        (kindFilter === 'all' || row.kind === kindFilter) &&
        (agentFilter === 'all' || row.agentProductId === agentFilter),
    );
  }, [state, kindFilter, agentFilter]);

  if (state.status === 'loading') return <Page title="Usage"><LoadingState /></Page>;
  if (state.status === 'error') {
    return (
      <Page title="Usage">
        <ErrorState message={state.error.message} onRetry={state.retry} />
      </Page>
    );
  }

  const data = state.data;

  if (data.kind === 'prepaid') {
    const agents = new Map<string, string>();
    for (const row of data.ledger) {
      if (row.agentProductId && row.agentName) agents.set(row.agentProductId, row.agentName);
    }
    const belowThreshold =
      data.warningThresholdTokens !== null && data.balanceTokens <= data.warningThresholdTokens;

    return (
      <Page
        eyebrow="Token account"
        title="Usage"
        description="Your prepaid token balance and chronological ledger. Every change to the balance is recorded by the Operator Console."
        actions={
          filtered && filtered.length > 0 ? (
            <Button variant="secondary" onClick={() => exportLedgerCsv(filtered)}>
              Export CSV
            </Button>
          ) : undefined
        }
      >
        <div className="stat-row">
          <StatCard label="Current balance" value={`${formatTokens(data.balanceTokens)} tokens`} />
          <StatCard
            label="Warning threshold"
            value={
              data.warningThresholdTokens !== null
                ? `${formatTokens(data.warningThresholdTokens)} tokens`
                : '—'
            }
          />
        </div>
        {belowThreshold ? (
          <p className="notice" role="status">
            Your token balance is at or below the warning threshold. Consider requesting additional prepaid credit.
          </p>
        ) : null}

        <Card title="Ledger statement">
          <div className="filter-bar" role="group" aria-label="Ledger filters">
            <label>
              Type
              <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
                <option value="all">All types</option>
                {Object.entries(KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Agent
              <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}>
                <option value="all">All agents</option>
                {[...agents.entries()].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {filtered && filtered.length > 0 ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Timestamp</th>
                    <th scope="col">Type</th>
                    <th scope="col">Tokens</th>
                    <th scope="col">Running balance</th>
                    <th scope="col">Reference</th>
                    <th scope="col">Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {[...filtered].reverse().map((row) => (
                    <tr key={row.transactionId}>
                      <td data-label="Timestamp">{formatDateTime(row.occurredAt)}</td>
                      <td data-label="Type">{KIND_LABELS[row.kind] ?? row.kind}</td>
                      <td data-label="Tokens" className={row.amountTokens < 0 ? 'token-debit' : 'token-credit'}>
                        {row.amountTokens > 0 ? `+${formatTokens(row.amountTokens)}` : formatTokens(row.amountTokens)}
                      </td>
                      <td data-label="Running balance">{formatTokens(row.runningBalanceTokens)}</td>
                      <td data-label="Reference">{row.reference}</td>
                      <td data-label="Agent">{row.agentName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="No ledger entries match the current filters." />
          )}
        </Card>
      </Page>
    );
  }

  return (
    <Page
      eyebrow="Commercial usage"
      title="Usage"
      description="Your commercial model does not use prepaid tokens, so there is no token ledger for your organization. The summary below shows recorded usage across your arrangements."
    >
      <Card title="Usage summary">
        {data.summary.rows.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Runs</th>
                  <th scope="col">Tokens consumed</th>
                </tr>
              </thead>
              <tbody>
                {data.summary.rows.map((row) => (
                  <tr key={row.agentProductId}>
                    <td data-label="Agent">{row.agentName}</td>
                    <td data-label="Runs">{row.usageCount}</td>
                    <td data-label="Tokens consumed">{formatTokens(row.tokensConsumed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No usage has been recorded for the current period." />
        )}
      </Card>
    </Page>
  );
}