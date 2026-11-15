// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CoManagedCustomerShell from '@/components/co-managed/CoManagedCustomerShell';

const check = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/coManagedAcceptanceActions', () => ({ getCoManagedPasswordStatus: check }));
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));
// Resolve keys strictly against the shipped English catalog (no defaultValue
// fallback) so a key missing from msp/core renders as the raw key and fails.
vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const catalog = JSON.parse(readFileSync(resolve(process.cwd(), 'public/locales/en/msp/core.json'), 'utf8'));
  const t = (key: string) => {
    const value = key.split('.').reduce<any>((node, segment) => node?.[segment], catalog);
    return typeof value === 'string' ? value : key;
  };
  return { useTranslation: () => ({ t }) };
});
vi.mock('@alga-psa/ui', () => ({ DrawerProvider: ({ children }: any) => children, DrawerOutlet: () => null }));
vi.mock('@alga-psa/scheduling/providers/StopwatchProvider', () => ({ StopwatchProvider: ({ children }: any) => children }));
vi.mock('@alga-psa/msp-composition/clients/MspClientTagsProvider', () => ({ MspClientTagsProvider: ({ children }: any) => children }));
vi.mock('@alga-psa/users/components/settings/PasswordChangeForm', () => ({
  default: ({ onSuccess }: { onSuccess: () => void }) => <button onClick={onSuccess}>Complete password setup</button>,
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('customer workspace', () => {
  it('shows customer content and navigation when the password is already set', async () => {
    check.mockResolvedValue({ hasResetPassword: true });
    render(<CoManagedCustomerShell><div>Ticket queue</div></CoManagedCustomerShell>);
    expect(await screen.findByText('Ticket queue')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Customer workspace' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tickets' })).toHaveAttribute('href', '/msp/tickets');
    expect(screen.getByRole('link', { name: 'Knowledge Base' })).toHaveAttribute('href', '/msp/knowledge-base');
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/msp/profile');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByText('Billing')).not.toBeInTheDocument();
    expect(screen.queryByText('Complete password setup')).not.toBeInTheDocument();
  });

  it('shows a loading status while password status is being checked', () => {
    check.mockReturnValue(new Promise(() => {}));
    render(<CoManagedCustomerShell><div>Ticket queue</div></CoManagedCustomerShell>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading workspace…');
    expect(screen.queryByText('Ticket queue')).not.toBeInTheDocument();
  });

  it('requires password setup before showing the workspace', async () => {
    check.mockResolvedValue({ hasResetPassword: false });
    render(<CoManagedCustomerShell><div>Ticket queue</div></CoManagedCustomerShell>);
    const setup = await screen.findByText('Complete password setup');
    expect(screen.queryByText('Ticket queue')).not.toBeInTheDocument();
    fireEvent.click(setup);
    expect(await screen.findByText('Ticket queue')).toBeInTheDocument();
  });

  it('does not show the workspace when password status cannot be read', async () => {
    check.mockRejectedValue(new Error('unavailable'));
    render(<CoManagedCustomerShell><div>Ticket queue</div></CoManagedCustomerShell>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to check password status');
    expect(screen.queryByText('Ticket queue')).not.toBeInTheDocument();
  });
});
