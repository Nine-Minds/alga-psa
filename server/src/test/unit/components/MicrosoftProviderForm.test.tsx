/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { MicrosoftProviderForm } from '@alga-psa/integrations/components';
import { renderWithProviders } from '../../utils/testWrapper';

// Mock server actions (single factory: the component sources all of these from
// the @alga-psa/integrations/actions barrel).
vi.mock('@alga-psa/integrations/actions', () => ({
  createEmailProvider: vi.fn(),
  updateEmailProvider: vi.fn(),
  upsertEmailProvider: vi.fn(),
  initiateEmailOAuth: vi.fn().mockResolvedValue({ success: false, error: 'not used in unit tests' }),
  getInboundTicketDefaults: vi.fn().mockResolvedValue({ defaults: [] }),
  getMicrosoftEmailIssuerOptions: vi.fn(),
}));

import * as emailProviderActions from '@alga-psa/integrations/actions';

const managedIssuers = {
  success: true,
  issuers: {
    managed: {
      kind: 'managed',
      label: 'AlgaPSA app (managed by Nine Minds)',
      clientId: 'managed-client-id',
      recommended: true,
    },
    profiles: [
      {
        kind: 'profile',
        label: 'Acme Email App',
        clientId: 'acme-client-id',
        profileId: 'profile-1',
        tenantId: 'tenant-dir-1',
      },
    ],
    recommended: { kind: 'managed', clientId: 'managed-client-id' },
  },
};

describe('MicrosoftProviderForm', () => {
  const mockOnSuccess = vi.fn();
  const mockOnCancel = vi.fn();

  const defaultProps = {
    tenant: 'test-tenant-123',
    onSuccess: mockOnSuccess,
    onCancel: mockOnCancel,
    emailSetup: {
      state: 'ready' as const,
      source: 'platform' as const,
      hosted: true,
      platformOffered: true,
      automatedCreationAvailable: true,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(emailProviderActions.getMicrosoftEmailIssuerOptions).mockResolvedValue(managedIssuers as any);
    // Mock window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'http://localhost:3000',
        href: 'http://localhost:3000',
        assign: vi.fn(),
      },
      writable: true,
    });
});
  afterEach(() => {
    cleanup();
  });

  it('should render form fields', () => {
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    expect(screen.getByPlaceholderText('e.g., Support Mailbox (internal)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('support@client.com')).toBeInTheDocument();
    expect(screen.queryByText('Redirect URI')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Inbox, Support, Custom Folder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in with microsoft/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add provider/i })).toBeInTheDocument();
  });

  it('should validate email format and show error message', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    await user.type(screen.getByPlaceholderText('e.g., Support Mailbox (internal)'), 'Test Provider');

    // Type invalid email
    const emailInput = screen.getByPlaceholderText('support@client.com');
    // The form has no noValidate, so jsdom's native email constraint blocks
    // submission entirely for plainly invalid values. Use a value that passes
    // the native check but fails zod's stricter pattern (requires a TLD).
    await user.type(emailInput, 'invalid@email');

    await user.click(screen.getByRole('button', { name: /add provider/i }));

    // Check that the error message is displayed
    await waitFor(() => {
      expect(screen.getByText('Valid email address is required')).toBeInTheDocument();
    });

    // The form should not submit with invalid email
    expect(emailProviderActions.createEmailProvider).not.toHaveBeenCalled();
  });

  it('should accept valid email formats without showing a validation error', async () => {
    const user = userEvent.setup();

    const validEmails = [
      'user@microsoft.com',
      'firstname.lastname@outlook.com',
      'user+tag@client.com',
      'user_name@organization.org',
    ];

    for (const validEmail of validEmails) {
      const { unmount } = renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

      const emailInput = screen.getByPlaceholderText('support@client.com');
      await user.type(emailInput, validEmail);

      await waitFor(() => {
        expect(screen.queryByText('Valid email address is required')).not.toBeInTheDocument();
      });

      unmount();
      vi.clearAllMocks();
    }
  });

  it('should clear email validation error when corrected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    await user.type(screen.getByPlaceholderText('e.g., Support Mailbox (internal)'), 'Test Provider');

    const emailInput = screen.getByPlaceholderText('support@client.com');

    // Type invalid email and attempt submit to trigger validation
    // The form has no noValidate, so jsdom's native email constraint blocks
    // submission entirely for plainly invalid values. Use a value that passes
    // the native check but fails zod's stricter pattern (requires a TLD).
    await user.type(emailInput, 'invalid@email');
    await user.click(screen.getByRole('button', { name: /add provider/i }));

    await waitFor(() => {
      expect(screen.getByText('Valid email address is required')).toBeInTheDocument();
    });

    // Clear and type valid email; re-validation happens on change after a failed submit
    await user.clear(emailInput);
    await user.type(emailInput, 'valid@client.com');

    await waitFor(() => {
      expect(screen.queryByText('Valid email address is required')).not.toBeInTheDocument();
    });
  });

  it('should submit form with valid data', async () => {
    vi.mocked(emailProviderActions.createEmailProvider).mockResolvedValueOnce({
      provider: {
        id: '123',
        tenant: 'test-tenant-123',
        providerType: 'microsoft',
        providerName: 'Test Microsoft Provider',
        mailbox: 'test@microsoft.com',
        isActive: true,
        status: 'connected',
        microsoftConfig: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } as any);

    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    await user.type(screen.getByPlaceholderText('e.g., Support Mailbox (internal)'), 'Test Microsoft Provider');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'test@microsoft.com');

    await user.click(screen.getByRole('button', { name: /add provider/i }));

    await waitFor(() => {
      expect(emailProviderActions.createEmailProvider).toHaveBeenCalledWith({
        tenant: 'test-tenant-123',
        providerType: 'microsoft',
        providerName: 'Test Microsoft Provider',
        senderDisplayName: null,
        mailbox: 'test@microsoft.com',
        isActive: true,
        inboundTicketDefaultsId: undefined,
        microsoftIssuer: { kind: 'managed', clientId: 'managed-client-id' },
        microsoftConfig: {
          client_id: '',
          client_secret: '',
          tenant_id: '',
          auto_process_emails: true,
          folder_filters: ['Inbox'],
          max_emails_per_sync: 50,
        },
      });
    });

    expect(mockOnSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '123',
        providerType: 'microsoft',
      })
    );
  });

  it('should handle API errors', async () => {
    vi.mocked(emailProviderActions.createEmailProvider).mockRejectedValueOnce(new Error('API Error'));

    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    await user.type(screen.getByPlaceholderText('e.g., Support Mailbox (internal)'), 'Test Provider');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'test@microsoft.com');

    await user.click(screen.getByRole('button', { name: /add provider/i }));

    await waitFor(() => {
      expect(screen.getByText(/API Error/i)).toBeInTheDocument();
    });
  });

  it('surfaces setupError in the form and does not report success when reconnect recovery fails', async () => {
    // The reconnect save on an auth-paused provider: the action persisted the
    // credentials but recovery was refused (bad client secret), so it returns
    // setupError AND the still-paused provider. The form must keep the
    // drawer open with the error shown and never call onSuccess — the parent
    // renders the cleared/kept pause banner from the provider it gets on
    // success only.
    vi.mocked(emailProviderActions.updateEmailProvider).mockResolvedValueOnce({
      provider: {
        id: 'paused-1',
        tenant: 'test-tenant-123',
        providerType: 'microsoft',
        providerName: 'Paused Mailbox',
        mailbox: 'paused@client.com',
        isActive: true,
        status: 'error',
        inboundPausedAt: '2026-08-16T00:00:00.000Z',
        inboundPauseReason: 'auth_failure',
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
      },
      setupError: 'Microsoft reconnection failed. Verify the client secret and try again.',
    } as any);

    const user = userEvent.setup();
    renderWithProviders(
      <MicrosoftProviderForm
        {...defaultProps}
        provider={{
          id: 'paused-1',
          tenant: 'test-tenant-123',
          providerType: 'microsoft' as const,
          providerName: 'Paused Mailbox',
          mailbox: 'paused@client.com',
          isActive: true,
          status: 'error' as const,
          inboundPausedAt: '2026-08-16T00:00:00.000Z',
          inboundPauseReason: 'auth_failure' as const,
          microsoftConfig: {
            redirect_uri: 'http://localhost:3000/api/auth/microsoft/callback',
            folder_filters: ['Inbox'],
            auto_process_emails: true,
            max_emails_per_sync: 50,
          },
          createdAt: '2026-08-15T00:00:00.000Z',
          updatedAt: '2026-08-15T00:00:00.000Z',
        } as any}
      />
    );

    await user.click(screen.getByRole('button', { name: /update provider/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Provider saved but setup incomplete: Microsoft reconnection failed/)
      ).toBeInTheDocument();
    });

    expect(mockOnSuccess).not.toHaveBeenCalled();
  });

  it('enables Microsoft sign-in once an app is selected, without a setup banner', async () => {
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    await screen.findByText('AlgaPSA app (managed by Nine Minds)');
    expect(screen.getByRole('button', { name: /sign in with microsoft/i })).toBeEnabled();
    expect(screen.queryByText(/isn't set up yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Microsoft is set up. Sign in as this mailbox to finish.')).not.toBeInTheDocument();
  });

  it('offers the own-app path as a quiet prompt when only the managed app exists', async () => {
    vi.mocked(emailProviderActions.getMicrosoftEmailIssuerOptions).mockResolvedValue({
      success: true,
      issuers: {
        managed: managedIssuers.issuers.managed,
        profiles: [],
        recommended: { kind: 'managed', clientId: 'managed-client-id' },
      },
    } as any);

    renderWithProviders(
      <MicrosoftProviderForm
        {...defaultProps}
        emailSetup={{
          state: 'not_configured',
          source: null,
          hosted: true,
          platformOffered: true,
          automatedCreationAvailable: true,
        }}
      />
    );

    await screen.findByText('AlgaPSA app (managed by Nine Minds)');
    expect(screen.getByText('Prefer to sign in with your own Microsoft app?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Set it up in Providers/i })).toBeInTheDocument();
    // Optional path guidance is not a warning and never blocks sign-in.
    expect(screen.queryByText(/isn't set up yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in with microsoft/i })).toBeEnabled();
  });

  it('keeps sign-in available and shows a quiet status while the own app awaits admin approval', async () => {
    vi.mocked(emailProviderActions.getMicrosoftEmailIssuerOptions).mockResolvedValue({
      success: true,
      issuers: {
        managed: managedIssuers.issuers.managed,
        profiles: [],
        recommended: { kind: 'managed', clientId: 'managed-client-id' },
      },
    } as any);

    renderWithProviders(
      <MicrosoftProviderForm
        {...defaultProps}
        emailSetup={{
          state: 'pending_admin_consent',
          source: 'tenant_app',
          hosted: true,
          platformOffered: true,
          automatedCreationAvailable: true,
          profileId: 'microsoft-profile-123',
        }}
      />
    );

    await screen.findByText('AlgaPSA app (managed by Nine Minds)');
    expect(
      screen.getByText(/still waiting for Microsoft 365 administrator approval/i)
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Open Providers/i })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Sign in with Microsoft/i })).toBeEnabled();
  });

  it('warns and points to Providers only when no Microsoft app can be selected', async () => {
    vi.mocked(emailProviderActions.getMicrosoftEmailIssuerOptions).mockResolvedValue({
      success: true,
      issuers: { managed: undefined, profiles: [], recommended: null },
    } as any);

    renderWithProviders(
      <MicrosoftProviderForm
        {...defaultProps}
        emailSetup={{
          state: 'not_configured',
          source: null,
          hosted: false,
          platformOffered: false,
          automatedCreationAvailable: false,
        }}
      />
    );

    expect(
      await screen.findByText(/first set up a Microsoft app in Providers/i)
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Open Providers/i })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Sign in with Microsoft/i })).toBeDisabled();
  });

  it('explains the pending own app in the empty state while approval is outstanding', async () => {
    vi.mocked(emailProviderActions.getMicrosoftEmailIssuerOptions).mockResolvedValue({
      success: true,
      issuers: { managed: undefined, profiles: [], recommended: null },
    } as any);

    renderWithProviders(
      <MicrosoftProviderForm
        {...defaultProps}
        emailSetup={{
          state: 'pending_admin_consent',
          source: 'tenant_app',
          hosted: false,
          platformOffered: false,
          automatedCreationAvailable: false,
          profileId: 'microsoft-profile-123',
        }}
      />
    );

    expect(
      await screen.findByText(/waiting for Microsoft 365 administrator approval/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign in with Microsoft/i })).toBeDisabled();
  });

  it('should call onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('should populate form when editing existing provider', () => {
    const existingProvider = {
      id: '123',
      tenant: 'test-tenant-123',
      providerType: 'microsoft' as const,
      providerName: 'Existing Microsoft',
      mailbox: 'existing@microsoft.com',
      isActive: true,
      status: 'connected' as const,
      microsoftConfig: {
        redirect_uri: 'http://localhost:3000/api/auth/microsoft/callback',
        folder_filters: ['Inbox', 'Sent Items'],
        auto_process_emails: false,
        max_emails_per_sync: 100,
      },
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };

    renderWithProviders(<MicrosoftProviderForm {...defaultProps} provider={existingProvider as any} />);

    expect(screen.getByDisplayValue('Existing Microsoft')).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing@microsoft.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Inbox, Sent Items')).toBeInTheDocument();
    expect(screen.getByDisplayValue(100)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update provider/i })).toBeInTheDocument();
  });

  it('should enable the provider by default', () => {
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    const enableSwitch = screen.getByRole('switch', { name: /enable this provider/i });
    expect(enableSwitch).toBeChecked();
  });

  it('should update max emails per sync', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    const maxEmailsInput = screen.getByDisplayValue(50);
    expect(maxEmailsInput).toHaveValue(50); // Default value

    await user.clear(maxEmailsInput);
    await user.type(maxEmailsInput, '200');
    expect(maxEmailsInput).toHaveValue(200);
  });

  it('lists the managed issuer as Recommended alongside eligible tenant apps', async () => {
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    expect(await screen.findByText('AlgaPSA app (managed by Nine Minds)')).toBeInTheDocument();
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByText('Acme Email App')).toBeInTheDocument();
  });

  it('carries the selected issuer and create purpose into OAuth initiation for a new mailbox', async () => {
    vi.mocked(emailProviderActions.upsertEmailProvider).mockResolvedValueOnce({
      provider: {
        id: 'provider-new',
        tenant: 'test-tenant-123',
        providerType: 'microsoft',
        providerName: 'New Microsoft',
        mailbox: 'new@microsoft.com',
        isActive: true,
        status: 'configuring',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } as any);
    vi.mocked(emailProviderActions.initiateEmailOAuth).mockResolvedValueOnce({
      success: true,
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      state: 'signed-token',
    } as any);

    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);
    await screen.findByText('AlgaPSA app (managed by Nine Minds)');

    await user.type(screen.getByPlaceholderText('e.g., Support Mailbox (internal)'), 'New Microsoft');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'new@microsoft.com');
    await user.click(screen.getByRole('button', { name: /sign in with microsoft/i }));

    await waitFor(() => {
      expect(emailProviderActions.initiateEmailOAuth).toHaveBeenCalledWith({
        provider: 'microsoft',
        providerId: 'provider-new',
        purpose: 'create',
        issuer: { kind: 'managed', clientId: 'managed-client-id' },
      });
    });
  });

  it('warns that switching the Microsoft app requires reconnecting an existing mailbox', async () => {
    const existingProvider = {
      id: '123',
      tenant: 'test-tenant-123',
      providerType: 'microsoft' as const,
      providerName: 'Existing Microsoft',
      mailbox: 'existing@microsoft.com',
      isActive: true,
      status: 'connected' as const,
      microsoftConfig: {
        client_id: 'acme-client-id',
        microsoft_profile_id: 'profile-1',
        client_secret_ref: 'microsoft_profile_profile-1_client_secret',
        tenant_id: 'tenant-dir-1',
        redirect_uri: 'http://localhost:3000/api/auth/microsoft/callback',
        folder_filters: ['Inbox'],
        auto_process_emails: true,
        max_emails_per_sync: 50,
      },
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };

    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} provider={existingProvider as any} />);
    const managedOption = await screen.findByText('AlgaPSA app (managed by Nine Minds)');

    expect(screen.queryByText(/changing the microsoft app requires reconnecting/i)).not.toBeInTheDocument();

    await user.click(managedOption);

    expect(
      screen.getByText(
        'Changing the Microsoft app requires reconnecting this mailbox. Sign in with Microsoft again to finish the switch.'
      )
    ).toBeInTheDocument();
  });

  it('keeps the persisted app labeled Current while a different app is selected pending reauthorization', async () => {
    const existingProvider = {
      id: '123',
      tenant: 'test-tenant-123',
      providerType: 'microsoft' as const,
      providerName: 'Existing Microsoft',
      mailbox: 'existing@microsoft.com',
      isActive: true,
      status: 'connected' as const,
      microsoftConfig: {
        client_id: 'acme-client-id',
        microsoft_profile_id: 'profile-1',
        client_secret_ref: 'microsoft_profile_profile-1_client_secret',
        tenant_id: 'tenant-dir-1',
        redirect_uri: 'http://localhost:3000/api/auth/microsoft/callback',
        folder_filters: ['Inbox'],
        auto_process_emails: true,
        max_emails_per_sync: 50,
      },
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };

    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} provider={existingProvider as any} />);
    await screen.findByText('AlgaPSA app (managed by Nine Minds)');

    // Persisted app is current; nothing selected differently yet, so no pending state.
    expect(screen.getByText('Current app: Acme Email App')).toBeInTheDocument();
    expect(screen.queryByText(/Selected app:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pending reauthorization/i)).not.toBeInTheDocument();

    // Select the managed app (a different app than the persisted Acme profile).
    await user.click(screen.getByText('AlgaPSA app (managed by Nine Minds)'));

    // Current must still be the persisted issuer; the new pick is selected/pending.
    expect(screen.getByText('Current app: Acme Email App')).toBeInTheDocument();
    expect(screen.getByText('Selected app: AlgaPSA app (managed by Nine Minds)')).toBeInTheDocument();
    expect(screen.getByText('Pending reauthorization')).toBeInTheDocument();
  });

  it('labels the persisted issuer Current with no pending state after a successful reconnect persistence', async () => {
    const postReconnectProvider = {
      id: '123',
      tenant: 'test-tenant-123',
      providerType: 'microsoft' as const,
      providerName: 'Existing Microsoft',
      mailbox: 'existing@microsoft.com',
      isActive: true,
      status: 'connected' as const,
      microsoftConfig: {
        client_id: 'managed-client-id',
        client_secret_ref: 'microsoft_managed_app_client_secret',
        tenant_id: 'common',
        redirect_uri: 'http://localhost:3000/api/auth/microsoft/callback',
        folder_filters: ['Inbox'],
        auto_process_emails: true,
        max_emails_per_sync: 50,
      },
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };

    renderWithProviders(<MicrosoftProviderForm {...defaultProps} provider={postReconnectProvider as any} />);
    await screen.findByText('AlgaPSA app (managed by Nine Minds)');

    // Beta (managed) is now the persisted issuer: it is Current, and because the
    // form defaults to the persisted app there is no pending/switch state.
    expect(screen.getByText('Current app: AlgaPSA app (managed by Nine Minds)')).toBeInTheDocument();
    expect(screen.queryByText(/Selected app:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pending reauthorization/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/changing the microsoft app requires reconnecting/i)).not.toBeInTheDocument();
  });

  it('shows no pending state when the already-persisted app is reselected', async () => {
    const existingProvider = {
      id: '123',
      tenant: 'test-tenant-123',
      providerType: 'microsoft' as const,
      providerName: 'Existing Microsoft',
      mailbox: 'existing@microsoft.com',
      isActive: true,
      status: 'connected' as const,
      microsoftConfig: {
        client_id: 'acme-client-id',
        microsoft_profile_id: 'profile-1',
        client_secret_ref: 'microsoft_profile_profile-1_client_secret',
        tenant_id: 'tenant-dir-1',
        redirect_uri: 'http://localhost:3000/api/auth/microsoft/callback',
        folder_filters: ['Inbox'],
        auto_process_emails: true,
        max_emails_per_sync: 50,
      },
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };

    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} provider={existingProvider as any} />);
    await screen.findByText('AlgaPSA app (managed by Nine Minds)');

    // Defaults to the persisted Acme profile: current, no pending.
    expect(screen.getByText('Current app: Acme Email App')).toBeInTheDocument();
    expect(screen.queryByText(/pending reauthorization/i)).not.toBeInTheDocument();

    // Switch away, then reselect the persisted app: pending state clears.
    await user.click(screen.getByText('AlgaPSA app (managed by Nine Minds)'));
    expect(screen.getByText('Selected app: AlgaPSA app (managed by Nine Minds)')).toBeInTheDocument();

    await user.click(screen.getByText('Acme Email App'));
    expect(screen.queryByText(/Selected app:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pending reauthorization/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/changing the microsoft app requires reconnecting/i)).not.toBeInTheDocument();
  });
});
