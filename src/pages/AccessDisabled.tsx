import { Link } from 'react-router';

export default function AccessDisabled() {
  return (
    <div className="standalone-page">
      <div className="standalone-card" role="status">
        <p className="eyebrow">Hivarium customer portal</p>
        <h1>Portal access is disabled</h1>
        <p>
          This evaluation workspace is disabled or has expired. Authentication succeeded,
          but customer data is not available. Contact the person who manages your
          Hivarium relationship if you believe this is a mistake.
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
