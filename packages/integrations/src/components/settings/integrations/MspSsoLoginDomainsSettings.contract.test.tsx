/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const listMspSsoDomainClaimsMock = vi.hoisted(() => vi.fn());
const verifyMspSsoDomainClaimOwnershipMock = vi.hoisted(() => vi.fn());
const requestMspSsoDomainClaimMock = vi.hoisted(() => vi.fn());
const refreshMspSsoDomainClaimChallengeMock = vi.hoisted(() => vi.fn());
const revokeMspSsoDomainClaimMock = vi.hoisted(() => vi.fn());
const listMspSsoLoginDomainsMock = vi.hoisted(() => vi.fn());
const saveMspSsoLoginDomainsMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/actions', () => ({
  listMspSsoDomainClaims: (...args: unknown[]) => listMspSsoDomainClaimsMock(...args),
  verifyMspSsoDomainClaimOwnership: (...args: unknown[]) =>
    verifyMspSsoDomainClaimOwnershipMock(...args),
  requestMspSsoDomainClaim: (...args: unknown[]) => requestMspSsoDomainClaimMock(...args),
  refreshMspSsoDomainClaimChallenge: (...args: unknown[]) =>
    refreshMspSsoDomainClaimChallengeMock(...args),
  revokeMspSsoDomainClaim: (...args: unknown[]) => revokeMspSsoDomainClaimMock(...args),
  listMspSsoLoginDomains: (...args: unknown[]) => listMspSsoLoginDomainsMock(...args),
  saveMspSsoLoginDomains: (...args: unknown[]) => saveMspSsoLoginDomainsMock(...args),
}));

vi.mock('@alga-psa/ui/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

async function renderEnterpriseClaimsView() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_EDITION = 'enterprise';
  const { MspSsoLoginDomainsSettings } = await import('./MspSsoLoginDomainsSettings');
  render(<MspSsoLoginDomainsSettings />);
}

describe('MspSsoLoginDomainsSettings EE contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    listMspSsoDomainClaimsMock.mockResolvedValue({
      success: true,
      claims: [
        {
          id: 'claim-1',
          domain: 'acme.com',
          claim_status: 'pending',
          active_challenge_label: '_alga-msp-sso.acme.com',
          active_challenge_value: 'token-123',
        },
        {
          id: 'claim-2',
          domain: 'northwind.com',
          claim_status: 'verified',
        },
      ],
    });
    verifyMspSsoDomainClaimOwnershipMock.mockResolvedValue({
      success: true,
    });
    requestMspSsoDomainClaimMock.mockResolvedValue({ success: true, idempotent: false });
    refreshMspSsoDomainClaimChallengeMock.mockResolvedValue({ success: true });
    revokeMspSsoDomainClaimMock.mockResolvedValue({ success: true });
    listMspSsoLoginDomainsMock.mockResolvedValue({ success: true, domains: [] });
    saveMspSsoLoginDomainsMock.mockResolvedValue({ success: true, domains: [] });
  });

  it('T019: renders EE claim lifecycle rows with status badges', async () => {
    await renderEnterpriseClaimsView();

    expect(await screen.findByText('acme.com')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('northwind.com')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('T020: renders DNS TXT verification instructions for pending claims', async () => {
    await renderEnterpriseClaimsView();

    expect(await screen.findByText('Add DNS TXT record, then click Verify:')).toBeInTheDocument();
    expect(screen.getByText('_alga-msp-sso.acme.com')).toBeInTheDocument();
    expect(screen.getByText('token-123')).toBeInTheDocument();
  });

  it('T021: shows neutral actionable error when claim verification fails', async () => {
    const user = userEvent.setup();
    verifyMspSsoDomainClaimOwnershipMock.mockResolvedValueOnce({ success: false });

    await renderEnterpriseClaimsView();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('Unable to verify domain claim.')).toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Domain verification failed',
        variant: 'destructive',
      }),
    );
  });
});
