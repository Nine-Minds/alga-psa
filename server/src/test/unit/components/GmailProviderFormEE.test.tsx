/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { GmailProviderForm } from '@ee/components/GmailProviderForm';
import { renderWithProviders } from '../../utils/testWrapper';

// The EE copy (ee/server/src/components/GmailProviderForm.tsx) imports its
// server actions via the deep module paths rather than the actions barrel
// the CE test mocks, so each deep module is mocked directly here.
vi.mock('@alga-psa/integrations/actions/email-actions/emailProviderActions', () => ({
  createEmailProvider: vi.fn(),
  updateEmailProvider: vi.fn(),
  upsertEmailProvider: vi.fn(),
}));
vi.mock('@alga-psa/integrations/actions/email-actions/inboundTicketDefaultsActions', () => ({
  getInboundTicketDefaults: vi.fn().mockResolvedValue({ defaults: [] }),
}));
vi.mock('@alga-psa/integrations/actions/email-actions/oauthActions', () => ({
  initiateEmailOAuth: vi.fn().mockResolvedValue({ success: false, error: 'not used in unit tests' }),
}));
vi.mock('@alga-psa/integrations/actions/integrations/googleActions', () => ({
  getGoogleIntegrationStatus: vi.fn().mockResolvedValue({
    success: true,
    config: {
      gmailClientId: 'client-id',
      gmailClientSecretMasked: '****',
      projectId: 'test-project',
      hasServiceAccountKey: true,
    },
  }),
}));

import * as emailProviderActions from '@alga-psa/integrations/actions/email-actions/emailProviderActions';

describe('GmailProviderForm (EE copy, ee/server)', () => {
  const mockOnSuccess = vi.fn();
  const mockOnCancel = vi.fn();

  const defaultProps = {
    tenant: 'test-tenant-123',
    onSuccess: mockOnSuccess,
    onCancel: mockOnCancel,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'http://localhost:3000',
        href: 'http://localhost:3000',
      },
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('surfaces setupError in the form and does not report success when reconnect recovery fails', async () => {
    // The reconnect save on an auth-paused Gmail provider: OAuth recovery
    // failed (revoked credentials / watch registration failure), so the
    // action returns setupError AND the still-paused provider. The EE form
    // must keep the drawer open with the error shown and never call
    // onSuccess — EmailProviderConfiguration wires onSuccess to
    // closeDrawer, which would destroy the error message and the
    // paused-state context while ingestion is still stopped.
    const pausedGmailProvider = {
      id: 'paused-gmail-1-ee',
      tenant: defaultProps.tenant,
      providerType: 'google',
      providerName: 'Support Gmail (paused)',
      mailbox: 'support@gmail.com',
      isActive: true,
      status: 'error',
      // googleConfig must be present for the form to seed defaultValues
      // from the provider (otherwise zod validation rejects the submit).
      googleConfig: {
        auto_process_emails: true,
        label_filters: ['INBOX'],
        max_emails_per_sync: 50,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(emailProviderActions.updateEmailProvider).mockResolvedValueOnce({
      provider: { ...pausedGmailProvider },
      setupError: 'Gmail reconnection failed. Reconnect the mailbox and try again.',
    } as any);

    const user = userEvent.setup();
    renderWithProviders(<GmailProviderForm {...defaultProps} provider={pausedGmailProvider as any} />);

    // The EE button label has no defaultValue, so without an i18n provider
    // the key itself renders as the accessible name.
    await user.click(screen.getByRole('button', { name: 'gmailForm.buttons.updateProvider' }));

    await waitFor(() => {
      expect(
        screen.getByText(/Provider saved but setup incomplete: Gmail reconnection failed/)
      ).toBeInTheDocument();
    });

    expect(mockOnSuccess).not.toHaveBeenCalled();
  });
});
