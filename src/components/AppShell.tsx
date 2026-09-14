import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, Outlet } from 'react-router';
import type { SessionAccountStatus } from '../../shared/types';
import { RoleBadge } from '../role-badge';

const NAV_ITEMS = [
  { to: '/overview', label: 'Overview' },
  { to: '/agents', label: 'Agents' },
  { to: '/licenses', label: 'Licenses' },
  { to: '/requests', label: 'Requests' },
  { to: '/account', label: 'Account' },
];

function Brand() {
  return (
    <Link to="/overview" className="brand" aria-label="Hivarium Customer Portal home">
      <span className="brand-mark" aria-hidden="true">
        H
      </span>
      <span>
        <strong>Hivarium</strong>
        <small>Customer portal</small>
      </span>
    </Link>
  );
}

function UserCard({ session, compact = false }: { session: SessionAccountStatus; compact?: boolean }) {
  return (
    <div className={`user-card ${compact ? 'user-card-compact' : ''}`.trim()}>
      <p className="user-email" title={session.user.email}>
        {session.user.displayName}
      </p>
      <p className="user-meta">
        {session.organization.name ?? 'Customer account'} · <RoleBadge role={session.user.role} />
      </p>
      <a className="sign-out" href={session.signOutUrl}>
        Sign out
      </a>
    </div>
  );
}

function Nav({ session, onNavigate }: { session: SessionAccountStatus; onNavigate?: () => void }) {
  const canRequest = session.capabilities.requestTypes.length > 0;
  return (
    <nav className="side-nav" aria-label="Primary">
      <ul>
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to !== '/requests'}
              onClick={onNavigate}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
      {canRequest ? (
        <NavLink to="/requests/new" className="btn btn-primary nav-new-request" onClick={onNavigate}>
          New request
        </NavLink>
      ) : null}
    </nav>
  );
}

export default function AppShell({ session }: { session: SessionAccountStatus }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!drawerOpen) return;
    drawerCloseRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
      menuButtonRef.current?.focus();
    };
  }, [drawerOpen]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <Nav session={session} />
        <UserCard session={session} />
      </aside>

      <div className="main-column">
        <header className="topbar">
          <button
            ref={menuButtonRef}
            type="button"
            className="menu-button"
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
            aria-controls="mobile-drawer"
            onClick={() => setDrawerOpen(true)}
          >
            <span className="menu-icon" aria-hidden="true" />
            <span>Menu</span>
          </button>
          <p className="topbar-org" title={session.organization.name ?? undefined}>
            {session.organization.name ?? 'Hivarium'}
          </p>
          {session.capabilities.requestTypes.length > 0 ? (
            <Link to="/requests/new" className="btn btn-primary topbar-new-request">
              New request
            </Link>
          ) : null}
        </header>

        {drawerOpen ? (
          <div className="drawer-layer" id="mobile-drawer">
            <button
              type="button"
              className="drawer-backdrop"
              aria-label="Close navigation menu"
              onClick={() => setDrawerOpen(false)}
            />
            <div className="drawer" role="dialog" aria-modal="true" aria-label="Navigation menu">
              <header className="drawer-header">
                <Brand />
                <button
                  ref={drawerCloseRef}
                  type="button"
                  className="drawer-close"
                  aria-label="Close menu"
                  onClick={() => setDrawerOpen(false)}
                >
                  Close
                </button>
              </header>
              <Nav session={session} onNavigate={() => setDrawerOpen(false)} />
              <UserCard session={session} />
            </div>
          </div>
        ) : null}

        <main className="content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
