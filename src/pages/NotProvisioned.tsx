import { Link } from 'react-router';

export default function NotProvisioned() {
  return (
    <div className="standalone-page">
      <div className="standalone-card" role="status">
        <p className="eyebrow">Hivarium customer portal</p>
        <h1>Your account has not been provisioned</h1>
        <p>
          Sign-in succeeded, but this email does not have a demo workspace yet.
          If you submitted a demo request, wait for operator approval. This page does
          not disclose other customers or tenants.
        </p>
        <div className="action-row">
          <a className="btn btn-primary" href="/cdn-cgi/access/logout">
            Sign out
          </a>
          <Link className="btn btn-secondary" to="/">
            Try again
          </Link>
        </div>
      </div>
    </div>
  );
}
