import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import AppShell from '../../src/components/AppShell';
import type { SessionAccountStatus } from '../../shared/types';

const session: SessionAccountStatus = {
  auth: 'session',
  user: { membershipId: 'mbr-acme-admin-001', email: 'dev.admin@acme.example', displayName: 'Dev Admin', role: 'customer_admin' },
  organization: { customerId: 'acme-dev-001', name: 'Acme Instruments' },
  capabilities: { requestTypes: ['renewal', 'agent_access'], canCancel: true, canComment: true },
  membershipStatus: 'active',
  signOutUrl: '/cdn-cgi/access/logout',
};

function renderShell(overrides: Partial<SessionAccountStatus> = {}) {
  return render(
    <MemoryRouter initialEntries={['/overview']}>
      <AppShell session={{ ...session, ...overrides }} />
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the organization identity and primary navigation', () => {
    renderShell();
    expect(screen.getByRole('link', { name: /Hivarium Customer Portal home/ })).toBeInTheDocument();
    for (const label of ['Overview', 'Agents', 'Licenses', 'Requests', 'Account']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('link', { name: 'Subscription' })).not.toBeInTheDocument();
    expect(screen.queryByText(/checkout|payment|credit card/i)).not.toBeInTheDocument();
    expect(screen.getByText('Acme Instruments')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign out' })).toHaveAttribute('href', '/cdn-cgi/access/logout');
  });

  it('shows a primary New request action for roles that can submit', () => {
    renderShell();
    const newRequestLinks = screen.getAllByRole('link', { name: 'New request' });
    expect(newRequestLinks.length).toBeGreaterThan(0);
    for (const link of newRequestLinks) {
      expect(link).toHaveAttribute('href', '/requests/new');
    }
  });

  it('hides New request for read-only roles', () => {
    renderShell({ user: { membershipId: 'mbr-acme-readonly-001', email: 'dev.readonly@acme.example', displayName: 'Dev Read-Only', role: 'read_only' }, capabilities: { requestTypes: [], canCancel: false, canComment: false } });
    expect(screen.queryByRole('link', { name: 'New request' })).not.toBeInTheDocument();
  });

  it('opens and closes the mobile navigation drawer', async () => {
    const user = userEvent.setup();
    renderShell();
    const menuButton = screen.getByRole('button', { name: 'Open navigation menu' });
    await user.click(menuButton);
    const dialog = await screen.findByRole('dialog', { name: 'Navigation menu' });
    expect(dialog).toBeInTheDocument();
    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes the drawer with Escape and restores focus to the menu trigger', async () => {
    const user = userEvent.setup();
    renderShell();
    const menuButton = screen.getByRole('button', { name: 'Open navigation menu' });
    await user.click(menuButton);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(menuButton).toHaveFocus();
  });

  it('closes the drawer when navigating from it', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Navigation menu' });
    const drawerNav = within(dialog).getByRole('navigation', { name: 'Primary' });
    const requestsLink = [...drawerNav.querySelectorAll('a')].find((a) => a.textContent === 'Requests');
    expect(requestsLink).toBeTruthy();
    await user.click(requestsLink!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps keyboard-accessible controls (focus lands on the close button)', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const closeButton = await screen.findByRole('button', { name: 'Close menu' });
    await waitFor(() => expect(closeButton).toHaveFocus());
  });

  it('marks the active navigation item', () => {
    renderShell();
    const overview = screen.getByRole('link', { name: 'Overview' });
    expect(overview).toHaveClass('active');
  });

  it('sign-out is a real Access logout link and is not clicked in jsdom', () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
      original.apply(console, args as []);
    };
    try {
      renderShell();
      const link = screen.getByRole('link', { name: 'Sign out' });
      expect(link.getAttribute('href')).toBe('/cdn-cgi/access/logout');
      expect(errors.some((entry) => String(entry).includes('Not implemented: navigation'))).toBe(false);
    } finally {
      console.error = original;
    }
  });

  describe('first-party magic-link sign-out', () => {
    it('renders a Sign out button instead of a legacy link', () => {
      renderShell({ signOutUrl: '/api/auth/logout' });
      const button = screen.getByRole('button', { name: 'Sign out' });
      expect(button).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Sign out' })).not.toBeInTheDocument();
      expect(button).toHaveClass('sign-out');
    });

    it('POSTs /api/auth/logout with same-origin credentials and accepts JSON', async () => {
      const assign = vi.fn();
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...window.location, assign },
      });
      const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();
      renderShell({ signOutUrl: '/api/auth/logout' });

      await user.click(screen.getByRole('button', { name: 'Sign out' }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('/api/auth/logout');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('same-origin');
      expect(new Headers(init?.headers).get('accept')).toBe('application/json');
      await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('redirects to /login after a non-204 safe outcome without failing sign-out', async () => {
      const assign = vi.fn();
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...window.location, assign },
      });
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
      const user = userEvent.setup();
      renderShell({ signOutUrl: '/api/auth/logout' });

      await user.click(screen.getByRole('button', { name: 'Sign out' }));

      await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'));
    });
  });
});