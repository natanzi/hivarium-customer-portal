import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../components/ui';

export default function ServiceUnavailable() {
  const [checked, setChecked] = useState(false);
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
          <Button
            variant="primary"
            onClick={() => {
              setChecked(true);
              window.location.reload();
            }}
          >
            Try again
          </Button>
          <a className="btn btn-secondary" href="/cdn-cgi/access/logout">
            Sign out
          </a>
        </div>
        <p className="hint-text" aria-live="polite">
          {checked ? 'Reloading…' : 'If this persists, contact Hivarium support.'}
        </p>
      </div>
    </div>
  );
}