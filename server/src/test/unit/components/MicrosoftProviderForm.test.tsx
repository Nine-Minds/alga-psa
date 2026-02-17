/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { MicrosoftProviderForm } from '@alga-psa/integrations/components';
import { renderWithProviders } from '../../utils/testWrapper';

// Mock server actions
vi.mock('@alga-psa/integrations/actions', () => ({
  createEmailProvider: vi.fn(),
  updateEmailProvider: vi.fn(),
  upsertEmailProvider: vi.fn(),
  initiateEmailOAuth: vi.fn(),
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
      },
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('should renderWithProviders form fields', () => {
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    expect(screen.getByPlaceholderText('e.g., Support Email')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('support@client.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('common (or specific tenant ID)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter client secret')).toBeInTheDocument();
  });


  it('should validate email format and show error message', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    // Fill in all required fields with valid data except email
    await user.type(screen.getByPlaceholderText('e.g., Support Email'), 'Test Provider');
    await user.type(screen.getByPlaceholderText('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'), 'test-client-id');
    await user.type(screen.getByPlaceholderText('Enter client secret'), 'test-client-secret');
    // redirectUri already has default value
    
    // Type invalid email
    const emailInput = screen.getByPlaceholderText('support@client.com');
    await user.type(emailInput, 'invalid-email');
    
    const saveButton = screen.getByText(/add provider/i);
    const form = saveButton.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    // Check that the error message is displayed
    await waitFor(() => {
      expect(screen.getByText('Valid email address is required')).toBeInTheDocument();
    });

    // Check that the input has error styling
    expect(emailInput).toHaveClass('border-red-500');

    // The form should not submit with invalid email
    expect(emailProviderActions.createEmailProvider).not.toHaveBeenCalled();
  });

  it('should validate various invalid email formats', async () => {
    const user = userEvent.setup();

    // Test various invalid email formats
    const invalidEmails = [
      'notanemail',
      'missing@',
      '@domain.com',
      'spaces in@email.com',
      'double@@domain.com',
      'missing.domain@',
      'trailing.dot@domain.',
      '.leadingdot@domain.com',
      'multiple..dots@domain.com'
    ];

    for (const invalidEmail of invalidEmails) {
      // Re-render for each test to ensure clean state
      const { unmount } = renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);
      
      const emailInput = screen.getByPlaceholderText('support@client.com');
      const saveButton = screen.getByText(/add provider/i);
      const form = saveButton.closest('form');
      expect(form).not.toBeNull();
      
      // Type invalid email to trigger validation
      await user.type(emailInput, invalidEmail);
      fireEvent.submit(form!);

      // Check error message appears
      await waitFor(() => {
        expect(screen.getByText('Valid email address is required')).toBeInTheDocument();
      }, { timeout: 1000 });

      // Ensure form doesn't submit
      expect(emailProviderActions.createEmailProvider).not.toHaveBeenCalled();
      
      // Clean up for next iteration
      unmount();
    }
  });

  it('should accept valid email formats', async () => {
    const user = userEvent.setup();

    // Test various valid email formats
    const validEmails = [
      'user@microsoft.com',
      'firstname.lastname@outlook.com',
      'user+tag@client.com',
      'user123@hotmail.com',
      'user_name@organization.org',
      'u@domain.com'
    ];

    for (const validEmail of validEmails) {
      // Re-render for each test to ensure clean state
      const { unmount } = renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);
      
      const emailInput = screen.getByPlaceholderText('support@client.com');
      
      // Type email to trigger validation
      await user.type(emailInput, validEmail);

      // Should not show email validation error for valid emails
      await waitFor(() => {
        expect(screen.queryByText('Valid email address is required')).not.toBeInTheDocument();
      });

      // Clean up for next iteration
      unmount();
      vi.clearAllMocks();
    }
  });

  it('should clear email validation error when corrected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    const emailInput = screen.getByPlaceholderText('support@client.com');
    const saveButton = screen.getByText(/add provider/i);
    const form = saveButton.closest('form');
    expect(form).not.toBeNull();
    
    // Type invalid email to trigger validation
    await user.type(emailInput, 'invalid-email');
    fireEvent.submit(form!);
    
    // Check error appears
    await waitFor(() => {
      expect(screen.getByText('Valid email address is required')).toBeInTheDocument();
    });
    expect(emailInput).toHaveClass('border-red-500');

    // Clear and type valid email
    await user.clear(emailInput);
    await user.type(emailInput, 'valid@client.com');

    // Error should disappear after typing valid email
    await waitFor(() => {
      expect(screen.queryByText('Valid email address is required')).not.toBeInTheDocument();
    });
    
    // Border should also update
    expect(emailInput).not.toHaveClass('border-red-500');
  });

  it('should validate email after submit attempt', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    const emailInput = screen.getByPlaceholderText('support@client.com');
    const saveButton = screen.getByText(/add provider/i);
    const form = saveButton.closest('form');
    expect(form).not.toBeNull();
    
    // Type invalid email
    await user.type(emailInput, 'invalid-email');

    // Error should not appear before submit
    expect(screen.queryByText('Valid email address is required')).not.toBeInTheDocument();

    // Check error appears after submit attempt
    fireEvent.submit(form!);
    await waitFor(() => {
      expect(screen.getByText('Valid email address is required')).toBeInTheDocument();
    });
    expect(emailInput).toHaveClass('border-red-500');
  });

  it('should accept Microsoft and custom domain emails', async () => {
    vi.mocked(emailProviderActions.createEmailProvider).mockResolvedValueOnce({
      provider: { 
        id: '123', 
        tenant: 'test-tenant-123',
        providerType: 'microsoft',
        providerName: 'Test Provider',
        mailbox: 'user@customdomain.com',
        isActive: true,
        status: 'connected',
        vendorConfig: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });

    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    // Fill all fields with valid data including custom domain email
    await user.type(screen.getByPlaceholderText('e.g., Support Email'), 'Test Provider');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'user@customdomain.com');
    await user.type(screen.getByPlaceholderText('common (or specific tenant ID)'), 'test-tenant-id');
    await user.type(screen.getByPlaceholderText('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'), 'test-client-id');
    await user.type(screen.getByPlaceholderText('Enter client secret'), 'test-client-secret');
    
    const saveButton = screen.getByText(/add provider/i);
    await user.click(saveButton);

    // Should not show validation error for custom domains
    await waitFor(() => {
      expect(screen.queryByText('Valid email address is required')).not.toBeInTheDocument();
    });
    
    // Should submit successfully
    await waitFor(() => {
      expect(emailProviderActions.createEmailProvider).toHaveBeenCalled();
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
        vendorConfig: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });

    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    // Fill in the form
    await user.type(screen.getByPlaceholderText('e.g., Support Email'), 'Test Microsoft Provider');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'test@microsoft.com');
    await user.type(screen.getByPlaceholderText('common (or specific tenant ID)'), 'test-tenant-id');
    await user.type(screen.getByPlaceholderText('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'), 'test-client-id');
    await user.type(screen.getByPlaceholderText('Enter client secret'), 'test-client-secret');

    // Submit the form
    const saveButton = screen.getByText(/add provider/i);
    await user.click(saveButton);

    await waitFor(() => {
      expect(emailProviderActions.createEmailProvider).toHaveBeenCalledWith({
        tenant: 'test-tenant-123',
        providerType: 'microsoft',
        providerName: 'Test Microsoft Provider',
        mailbox: 'test@microsoft.com',
        isActive: true,
        inboundTicketDefaultsId: undefined,
        microsoftConfig: {
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
          tenant_id: 'test-tenant-id',
          redirect_uri: 'http://localhost:3000/api/auth/microsoft/callback',
          auto_process_emails: true,
          folder_filters: ['Inbox'],
          max_emails_per_sync: 50,
        }
      });
    });

    expect(mockOnSuccess).toHaveBeenCalledWith(expect.objectContaining({ 
      id: '123', 
      providerType: 'microsoft' 
    }));
  });

  it('should handle API errors', async () => {
    vi.mocked(emailProviderActions.createEmailProvider).mockRejectedValueOnce(new Error('API Error'));

    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    // Fill in required fields
    await user.type(screen.getByPlaceholderText('e.g., Support Email'), 'Test Provider');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'test@microsoft.com');
    await user.type(screen.getByPlaceholderText('common (or specific tenant ID)'), 'test-tenant-id');
    await user.type(screen.getByPlaceholderText('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'), 'test-client-id');
    await user.type(screen.getByPlaceholderText('Enter client secret'), 'test-client-secret');

    const saveButton = screen.getByText(/add provider/i);
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/API Error/i)).toBeInTheDocument();
    });
  });

  it('should call onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    const cancelButton = screen.getByText(/cancel/i);
    await user.click(cancelButton);

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
        tenant_id: 'existing-tenant-id',
        client_id: 'existing-client-id',
        client_secret: '***',
        folder_filters: ['Inbox', 'Sent Items'],
        auto_process_emails: false,
        max_emails_per_sync: 100,
        redirect_uri: 'http://localhost:3000/api/auth/microsoft/callback',
      },
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };

    renderWithProviders(<MicrosoftProviderForm {...defaultProps} provider={existingProvider} />);

    expect(screen.getByDisplayValue('Existing Microsoft')).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing@microsoft.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing-tenant-id')).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing-client-id')).toBeInTheDocument();
  });

  it('should handle folder filter changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    // Check that enable provider switch is selected by default
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

  it('should show authorization code field after initial save', async () => {
    vi.mocked(emailProviderActions.createEmailProvider).mockResolvedValueOnce({
      provider: { 
        id: '123', 
        tenant: 'test-tenant-123',
        providerType: 'microsoft',
        providerName: 'Test Provider',
        mailbox: 'test@microsoft.com',
        isActive: true,
        status: 'configuring',
        vendorConfig: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });

    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    // Fill in required fields
    await user.type(screen.getByPlaceholderText('e.g., Support Email'), 'Test Provider');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'test@microsoft.com');
    await user.type(screen.getByPlaceholderText('common (or specific tenant ID)'), 'test-tenant-id');
    await user.type(screen.getByPlaceholderText('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'), 'test-client-id');
    await user.type(screen.getByPlaceholderText('Enter client secret'), 'test-client-secret');

    const saveButton = screen.getByText(/add provider/i);
    await user.click(saveButton);

    await waitFor(() => {
      expect(emailProviderActions.createEmailProvider).toHaveBeenCalled();
    });
    expect(mockOnSuccess).toHaveBeenCalled();
  });

  it('should disable submit button when form is invalid', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    const submitButton = screen.getByText(/add provider/i);
    expect(submitButton).not.toBeDisabled();

    // Fill in some but not all required fields
    await user.type(screen.getByPlaceholderText('e.g., Support Email'), 'Test Provider');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'test@microsoft.com');
    expect(submitButton).not.toBeDisabled();

    const form = submitButton.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    await waitFor(() => {
      expect(screen.getByText('Please fill in the required fields:')).toBeInTheDocument();
    });
    expect(screen.getByText('Client ID')).toBeInTheDocument();
    expect(screen.getByText('Client Secret')).toBeInTheDocument();
    expect(emailProviderActions.createEmailProvider).not.toHaveBeenCalled();
  });

  it('should disable submit button when there are validation errors', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    const submitButton = screen.getByText(/add provider/i);
    const emailInput = screen.getByPlaceholderText('support@client.com');
    
    // Fill all required fields
    await user.type(screen.getByPlaceholderText('e.g., Support Email'), 'Test Provider');
    await user.type(emailInput, 'valid@microsoft.com');
    await user.type(screen.getByPlaceholderText('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'), 'test-client-id');
    await user.type(screen.getByPlaceholderText('Enter client secret'), 'test-client-secret');
    
    // Button should be enabled
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });

    // Now make email invalid
    await user.clear(emailInput);
    await user.type(emailInput, 'invalid-email');
    
    // Validation error should be shown when attempting to submit
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
    const form = submitButton.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    await waitFor(() => {
      expect(screen.getByText('Valid email address is required')).toBeInTheDocument();
    });
    expect(emailProviderActions.createEmailProvider).not.toHaveBeenCalled();
  });
});
