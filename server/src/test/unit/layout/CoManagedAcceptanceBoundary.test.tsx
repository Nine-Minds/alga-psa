// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Boundary from '@/components/co-managed/CoManagedAcceptanceBoundary';
import CustomerShell from '@/components/co-managed/CoManagedCustomerShell';

const mocks = vi.hoisted(() => ({ read: vi.fn(), accept: vi.fn(), password: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));
vi.mock('@alga-psa/ui', () => ({ DrawerProvider: ({ children }: any) => children, DrawerOutlet: () => null }));
vi.mock('@alga-psa/scheduling/providers/StopwatchProvider', () => ({ StopwatchProvider: ({ children }: any) => children }));
vi.mock('@alga-psa/msp-composition/clients/MspClientTagsProvider', () => ({ MspClientTagsProvider: ({ children }: any) => children }));
vi.mock('@/lib/actions/coManagedAcceptanceActions', () => ({
  getCustomerCoManagedAcceptance: mocks.read,
  acceptCustomerCoManagedRelationship: mocks.accept,
  declineCustomerCoManagedRelationship: vi.fn(),
  getCoManagedPasswordStatus: mocks.password,
}));
vi.mock('@alga-psa/users/components/settings/PasswordChangeForm', () => ({ default: () => <div>Set password</div> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }) }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: () => null }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('customer acceptance', () => {
  it('holds workspace content until consent and sends a newly accepted customer to tickets', async () => {
    mocks.read.mockResolvedValueOnce({ state: 'pending_acceptance', canAccept: true, relationshipId: 'r', revision: 1,
      scopeFingerprint: 'f', scope: { sponsorName: 'Sponsor', visibilityMode: 'board_scope', boards: [], escalationBoard: { name: 'Help' } } })
      .mockResolvedValue({ state: 'active' });
    mocks.accept.mockResolvedValue(undefined);
    mocks.password.mockResolvedValue({ hasResetPassword: true });
    render(<Boundary><CustomerShell><div>Ticket queue</div></CustomerShell></Boundary>);
    const accept = await screen.findByText('coManaged.acceptance.accept');
    expect(screen.queryByText('Ticket queue')).not.toBeInTheDocument();
    expect(mocks.password).not.toHaveBeenCalled();
    fireEvent.click(accept);
    expect(await screen.findByText('Ticket queue')).toBeInTheDocument();
    expect(screen.queryByText('Billing')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/msp/tickets'));
  });
});
