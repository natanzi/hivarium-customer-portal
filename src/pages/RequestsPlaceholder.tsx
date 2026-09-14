import { Page, LinkButton } from '../components/ui';

export default function RequestsPlaceholder() {
  return (
    <Page
      eyebrow="Service requests"
      title="Requests"
      description="Create, track and manage requests to Hivarium for renewals, capacity, prepaid credit, agent access and support."
      actions={
        <LinkButton to="/requests/new" className="hide-on-mobile">
          New request
        </LinkButton>
      }
    >
      <p className="hint-text">The requests workspace is being finalized in the next slice of work.</p>
    </Page>
  );
}