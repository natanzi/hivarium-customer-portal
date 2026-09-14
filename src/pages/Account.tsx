import { useSession } from '../session';
import { Card, DefList, LinkButton, LoadingState, OutboundLink, Page, UnavailableState } from '../components/ui';
import { RoleBadge } from '../role-badge';
import { REQUEST_TYPE_LABELS, type RequestType } from '../../shared/types';

export default function Account() {
  const sessionState = useSession();

  if (sessionState.status === 'loading') {
    return (
      <Page title="Account">
        <LoadingState />
      </Page>
    );
  }
  if (sessionState.status === 'unauthorized') {
    return (
      <Page title="Account">
        <UnavailableState title="Not signed in" message="Your session could not be verified. Sign in again to continue." />
      </Page>
    );
  }
  if (sessionState.status === 'unavailable') {
    return (
      <Page title="Account">
        <UnavailableState />
      </Page>
    );
  }

  const session = sessionState.session;
  const capabilityLabels: string[] = [
    ...session.capabilities.requestTypes.map((t) => `Submit ${REQUEST_TYPE_LABELS[t as RequestType].toLowerCase()} requests`),
    ...(session.capabilities.canCancel ? ['Cancel submitted requests'] : []),
    ...(session.capabilities.canComment ? ['Comment on requests'] : []),
  ];

  return (
    <Page eyebrow="Your account" title="Account">
      <Card title="Authenticated user">
        <DefList
          items={[
            { term: 'Name', detail: session.user.displayName },
            { term: 'Email', detail: session.user.email },
            { term: 'Role', detail: <RoleBadge role={session.user.role} /> },
            { term: 'Organization', detail: session.organization.name ?? 'Customer account' },
            { term: 'Session', detail: 'Verified through Cloudflare Access' },
          ]}
        />
      </Card>

      <Card title="Allowed capabilities">
        <ul className="check-list">
          {capabilityLabels.length > 0 ? (
            capabilityLabels.map((label) => <li key={label}>{label}</li>)
          ) : (
            <li>Viewing only — this role cannot submit, cancel or comment on requests.</li>
          )}
        </ul>
        <p className="hint-text">
          Team administration is read-only in this portal. Members and roles are managed by Hivarium.
        </p>
      </Card>

      <Card title="Session">
        <div className="action-row">
          <OutboundLink href={session.signOutUrl}>Sign out</OutboundLink>
          <LinkButton to="/requests/new" variant="secondary" className="hide-on-mobile">
            New request
          </LinkButton>
        </div>
      </Card>
    </Page>
  );
}