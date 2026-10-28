// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CoManagedCustomerShell from '@/components/co-managed/CoManagedCustomerShell';

const check = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/coManagedAcceptanceActions', () => ({ getCoManagedPasswordStatus: check }));
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_: string, opts: { defaultValue: string }) => opts.defaultValue }) }));
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
    expect(screen.getByRole('link', { name: 'Tickets' })).toHaveAttribute('href', '/msp/tickets');
    expect(screen.queryByText('Billing')).not.toBeInTheDocument();
    expect(screen.queryByText('Complete password setup')).not.toBeInTheDocument();
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
