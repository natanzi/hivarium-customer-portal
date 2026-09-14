import { Link } from 'react-router';

export default function Unauthorized() {
  return (
    <div className="standalone-page">
      <div className="standalone-card" role="status">
        <p className="eyebrow">Hivarium customer portal</p>
        <h1>Not authorized</h1>
        <p>
          Your account is not registered for this portal, or your access has been
          disabled. If you believe this is a mistake, contact the person who manages
          your Hivarium relationship.
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