import { useApi } from '../lib/useApi';
import { apiFetch } from '../api/client';
import type { CommercialArrangement, SubscriptionData } from '../../shared/types';
import {
  Card,
  DefList,
  ErrorState,
  LinkButton,
  LoadingState,
  Page,
  StatusPill,
  formatDate,
  formatTokens,
  modelLabel,
} from '../components/ui';

function arrangementFields(arrangement: CommercialArrangement): Array<{ term: string; detail: string }> {
  const fields: Array<{ term: string; detail: string }> = [
    { term: 'Status', detail: arrangement.status },
    { term: 'Effective date', detail: formatDate(arrangement.effectiveDate) },
  ];
  if (arrangement.model === 'monthly_subscription') {
    fields.push({ term: 'Next renewal', detail: formatDate(arrangement.renewalDate) });
  }
  if (arrangement.model === 'annual_contract') {
    fields.push({ term: 'Contract end', detail: formatDate(arrangement.endDate) });
    fields.push({ term: 'Renewal window opens', detail: formatDate(arrangement.renewalDate) });
  }
  if (arrangement.model === 'prepaid_tokens') {
    fields.push({ term: 'Period end', detail: formatDate(arrangement.endDate) });
    fields.push({
      term: 'Prepaid balance',
      detail:
        arrangement.prepaidBalanceTokens !== null
          ? `${formatTokens(arrangement.prepaidBalanceTokens)} tokens`
          : '—',
    });
    if (arrangement.warningThresholdTokens !== null) {
      fields.push({
        term: 'Warning threshold',
        detail: `${formatTokens(arrangement.warningThresholdTokens)} tokens`,
      });
    }
  }
  if (arrangement.model === 'negotiated_agreement' || arrangement.model === 'bare_metal_agreement') {
    fields.push({ term: 'Agreement end', detail: formatDate(arrangement.endDate) });
    if (arrangement.prepaidBalanceTokens !== null) {
      fields.push({
        term: 'Prepaid balance',
        detail: `${formatTokens(arrangement.prepaidBalanceTokens)} tokens`,
      });
    }
  }
  if (arrangement.seatCapacity !== null) fields.push({ term: 'Seat capacity', detail: String(arrangement.seatCapacity) });
  if (arrangement.agentCapacity !== null) fields.push({ term: 'Agent capacity', detail: String(arrangement.agentCapacity) });
  if (arrangement.contractReference) fields.push({ term: 'Contract reference', detail: arrangement.contractReference });
  if (arrangement.deploymentModel) fields.push({ term: 'Deployment model', detail: arrangement.deploymentModel });
  if (arrangement.bareMetal) fields.push({ term: 'Deployment model', detail: 'Bare metal' });
  if (arrangement.offlineAllowed) fields.push({ term: 'Offline operation', detail: 'Allowed' });
  if (arrangement.bareMetal || arrangement.offlineAllowed) {
    fields.push({ term: 'Bare-metal / offline constraints', detail: 'License validation happens on the machine; no continuous connectivity required.' });
  }
  return fields;
}

export default function Subscription() {
  const state = useApi<SubscriptionData>(() => apiFetch('/api/v1/subscription'), []);

  if (state.status === 'loading') return <Page title="Subscription"><LoadingState /></Page>;
  if (state.status === 'error') {
    return (
      <Page title="Subscription">
        <ErrorState message={state.error.message} onRetry={state.retry} />
      </Page>
    );
  }

  const { commercial } = state.data;
  const active = commercial.active[0] ?? null;

  return (
    <Page
      eyebrow="Commercial relationship"
      title="Subscription"
      description={
        active
          ? `Your current arrangement is a ${modelLabel(active.model)}.`
          : 'No active commercial arrangement is recorded.'
      }
    >
      {active ? (
        <Card title={`${modelLabel(active.model)}`} actions={<StatusPill status={active.status} />}>
          <DefList items={arrangementFields(active)} />
        </Card>
      ) : (
        <Card title="No active arrangement">
          <p className="text-faint">Your relationship is being reviewed. Please contact Hivarium support.</p>
        </Card>
      )}

      <Card title="What would you like to do?">
        <div className="action-grid">
          <LinkButton to="/requests/new?type=renewal" variant="secondary">
            Request renewal
          </LinkButton>
          <LinkButton to="/requests/new?type=capacity_increase" variant="secondary">
            Request capacity change
          </LinkButton>
          <LinkButton to="/requests/new?type=prepaid_credit" variant="secondary">
            Request prepaid credit
          </LinkButton>
          <LinkButton to="/requests/new?type=general_support" variant="secondary">
            Ask a billing question
          </LinkButton>
        </div>
        <p className="hint-text">All changes are reviewed by Hivarium before they take effect. Requests are not automatic.</p>
      </Card>

      {commercial.history.length > 0 ? (
        <Card title="Arrangement history">
          <ul className="plain-list">
            {commercial.history.map((arrangement) => (
              <li key={arrangement.id} className="plain-row">
                <div>
                  <p className="plain-title">{modelLabel(arrangement.model)}</p>
                  <p className="text-faint">
                    {formatDate(arrangement.effectiveDate)} — {formatDate(arrangement.endDate)}
                  </p>
                </div>
                <StatusPill status={arrangement.status} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </Page>
  );
}