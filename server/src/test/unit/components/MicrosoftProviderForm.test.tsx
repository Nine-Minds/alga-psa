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
  getMicrosoftConsumerSetupStatus: vi.fn().mockResolvedValue({ success: true, ready: true, message: null }),
  initiateEmailOAuth: vi.fn().mockResolvedValue({ success: false, error: 'not used in unit tests' }),
  getInboundTicketDefaults: vi.fn().mockResolvedValue({ defaults: [] }),
}));

import * as emailProviderActions from '@alga-psa/integrations/actions';

describe('MicrosoftProviderForm', () => {
  const mockOnSuccess = vi.fn();
  const mockOnCancel = vi.fn();

  const defaultProps = {
    tenant: 'test-tenant-123',
    onSuccess: mockOnSuccess,
    onCancel: mockOnCancel,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.location
    Object.defineProperty(window, 'location', {
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
    expect(screen.getByPlaceholderText('https://yourapp.com/api/auth/microsoft/callback')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Inbox, Support, Custom Folder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /authorize access/i })).toBeInTheDocument();
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
        microsoftConfig: {
          client_id: '',
          client_secret: '',
          tenant_id: '',
          redirect_uri: 'http://localhost:3000/api/auth/microsoft/callback',
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
});
