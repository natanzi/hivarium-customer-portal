import { Link } from 'react-router';

export default function ServiceUnavailable() {
  return (
    <div className="standalone-page">
      <div className="standalone-card" role="status">
        <p className="eyebrow">Hivarium customer portal</p>
        <h1>Temporarily unavailable</h1>
        <p>
          The portal cannot verify your session right now. No action is needed — the
          page will become available again shortly.
        </p>
        <div className="action-row">
          <Link className="btn btn-primary" to="/overview">
            Try again
          </Link>
          <a className="btn btn-secondary" href="/cdn-cgi/access/logout">
            Sign out
          </a>
        </div>
        <p className="hint-text">If this persists, contact Hivarium support.</p>
      </div>
    </div>
  );
}
