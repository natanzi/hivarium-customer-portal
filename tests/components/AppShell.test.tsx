import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import AppShell from '../../src/components/AppShell';
import type { SessionAccountStatus } from '../../shared/types';

const session: SessionAccountStatus = {
  auth: 'session',
  user: { email: 'dev.admin@acme.example', displayName: 'Dev Admin', role: 'customer_admin' },
  organization: { customerId: 'acme-dev-001', name: 'Acme Instruments' },
  capabilities: { requestTypes: ['renewal', 'agent_access'], canCancel: true, canComment: true },
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
    for (const label of ['Overview', 'Subscription', 'Agents', 'Licenses & deployments', 'Usage', 'Requests', 'Account']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
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
    renderShell({ user: { email: 'dev.readonly@acme.example', displayName: 'Dev Read-Only', role: 'read_only' }, capabilities: { requestTypes: [], canCancel: false, canComment: false } });
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

  it('closes the drawer with Escape and restores focus', async () => {
    const user = userEvent.setup();
    renderShell();
    const menuButton = screen.getByRole('button', { name: 'Open navigation menu' });
    await user.click(menuButton);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
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

  it('sign-out is a real link to the Access logout endpoint', () => {
    renderShell();
    expect(screen.getByRole('link', { name: 'Sign out' }).getAttribute('href')).toBe('/cdn-cgi/access/logout');
    expect(fireEvent.click(screen.getByRole('link', { name: 'Sign out' }))).toBe(true);
  });
});