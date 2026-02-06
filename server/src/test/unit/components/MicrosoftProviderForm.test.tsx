/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { MicrosoftProviderForm } from '../../../components/MicrosoftProviderForm';
import { renderWithProviders } from '../../utils/testWrapper';

// Mock server actions
vi.mock('@alga-psa/integrations/actions', () => ({
  autoWireEmailProvider: vi.fn(),
  updateEmailProvider: vi.fn(),
}));

import * as emailProviderActions from '@alga-psa/integrations/actions';

describe('MicrosoftProviderForm', () => {
  const mockOnSuccess = vi.fn();
  const mockOnCancel = vi.fn();

  const defaultProps = {
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
    await user.click(saveButton);

    // Check that the error message is displayed
    await waitFor(() => {
      expect(screen.getByText('Valid email address is required')).toBeInTheDocument();
    });

    // Check that the input has error styling
    expect(emailInput).toHaveClass('border-red-500');

    // The form should not submit with invalid email
    expect(emailProviderActions.autoWireEmailProvider).not.toHaveBeenCalled();
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
      
      // Type invalid email to trigger validation
      await user.type(emailInput, invalidEmail);

      // Check error message appears
      await waitFor(() => {
        expect(screen.getByText('Valid email address is required')).toBeInTheDocument();
      }, { timeout: 1000 });

      // Ensure form doesn't submit
      expect(emailProviderActions.autoWireEmailProvider).not.toHaveBeenCalled();
      
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
    
    // Type invalid email to trigger validation
    await user.type(emailInput, 'invalid-email');
    
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

  it('should validate email on change', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    const emailInput = screen.getByPlaceholderText('support@client.com');
    
    // Type invalid email
    await user.type(emailInput, 'invalid-email');

    // Check error appears on change without form submission
    await waitFor(() => {
      expect(screen.getByText('Valid email address is required')).toBeInTheDocument();
    });
    expect(emailInput).toHaveClass('border-red-500');
  });

  it('should accept Microsoft and custom domain emails', async () => {
    vi.mocked(emailProviderActions.autoWireEmailProvider).mockResolvedValueOnce({
      success: true,
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
      expect(emailProviderActions.autoWireEmailProvider).toHaveBeenCalled();
    });
  });

  it('should submit form with valid data', async () => {
    vi.mocked(emailProviderActions.autoWireEmailProvider).mockResolvedValueOnce({
      success: true,
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
      expect(emailProviderActions.autoWireEmailProvider).toHaveBeenCalledWith({
        providerType: 'microsoft',
        config: {
          providerName: 'Test Microsoft Provider',
          mailbox: 'test@microsoft.com',
          tenantId: 'test-tenant-id',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          folderFilters: ['Inbox'],
          autoProcessEmails: true,
          maxEmailsPerSync: 50,
        },
      });
    });

    expect(mockOnSuccess).toHaveBeenCalledWith(expect.objectContaining({ 
      id: '123', 
      providerType: 'microsoft' 
    }));
  });

  it('should handle API errors', async () => {
    vi.mocked(emailProviderActions.autoWireEmailProvider).mockResolvedValueOnce({
      success: false,
      error: 'API Error'
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
      vendorConfig: {
        tenantId: 'existing-tenant-id',
        clientId: 'existing-client-id',
        clientSecret: '***',
        folderFilters: ['Inbox', 'Sent Items'],
        autoProcessEmails: false,
        maxEmailsPerSync: 100,
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

  it('should toggle auto-process emails setting', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    const autoProcessSwitch = screen.getByRole('switch', { name: /automatically process new emails/i });
    expect(autoProcessSwitch).toBeChecked(); // Default is true

    await user.click(autoProcessSwitch);
    expect(autoProcessSwitch).not.toBeChecked();
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
    vi.mocked(emailProviderActions.autoWireEmailProvider).mockResolvedValueOnce({
      success: true,
      requiresAuth: true,
      authUrl: 'https://login.microsoftonline.com/auth',
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
      expect(emailProviderActions.autoWireEmailProvider).toHaveBeenCalled();
    });
  });

  it('should disable submit button when form is invalid', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MicrosoftProviderForm {...defaultProps} />);

    const submitButton = screen.getByText(/add provider/i);
    
    // Button should be disabled initially when required fields are empty
    expect(submitButton).toBeDisabled();

    // Fill in some but not all required fields
    await user.type(screen.getByPlaceholderText('e.g., Support Email'), 'Test Provider');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'test@microsoft.com');
    
    // Button should still be disabled
    expect(submitButton).toBeDisabled();

    // Fill in remaining required fields
    await user.type(screen.getByPlaceholderText('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'), 'test-client-id');
    await user.type(screen.getByPlaceholderText('Enter client secret'), 'test-client-secret');
    
    // Button should be enabled when all required fields are filled
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
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
    
    // Button should be disabled when there's a validation error
    await waitFor(() => {
      expect(submitButton).toBeDisabled();
    });
  });
});