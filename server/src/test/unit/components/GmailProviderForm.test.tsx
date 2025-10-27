/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { GmailProviderForm } from '../../../components/GmailProviderForm';
import { renderWithProviders } from '../../utils/testWrapper';

// Mock server actions
vi.mock('@product/actions/email-actions/emailProviderActions', () => ({
  autoWireEmailProvider: vi.fn(),
  updateEmailProvider: vi.fn(),
}));

import * as emailProviderActions from '@product/actions/email-actions/emailProviderActions';

describe('GmailProviderForm', () => {
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

  it('should render form fields', () => {
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    expect(screen.getByPlaceholderText('e.g., Support Gmail')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('support@client.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('xxxxxxxxx.apps.googleusercontent.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter client secret')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('my-project-id')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('gmail-notifications')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('gmail-webhook-subscription')).toBeInTheDocument();
  });


  it('should validate email format and show error message', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    // Fill in all required fields with valid data except email
    await user.type(screen.getByPlaceholderText('e.g., Support Gmail'), 'Test Provider');
    await user.type(screen.getByPlaceholderText('xxxxxxxxx.apps.googleusercontent.com'), 'test-client-id');
    await user.type(screen.getByPlaceholderText('Enter client secret'), 'test-client-secret');
    await user.type(screen.getByPlaceholderText('my-project-id'), 'test-project-id');
    // redirectUri, pubSubTopic and pubSubSubscription already have default values
    
    // Type invalid email
    const emailInput = screen.getByPlaceholderText('support@client.com');
    await user.type(emailInput, 'invalid-email');
    
    const saveButton = screen.getByText(/add provider/i);
    await user.click(saveButton);

    // Check that the error message is displayed
    await waitFor(() => {
      expect(screen.getByText('Valid Gmail address is required')).toBeInTheDocument();
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
      const { unmount } = renderWithProviders(<GmailProviderForm {...defaultProps} />);
      
      const emailInput = screen.getByPlaceholderText('support@client.com');
      
      // Type invalid email to trigger validation
      await user.type(emailInput, invalidEmail);

      // Check error message appears
      await waitFor(() => {
        expect(screen.getByText('Valid Gmail address is required')).toBeInTheDocument();
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
      'user@gmail.com',
      'firstname.lastname@gmail.com',
      'user+tag@gmail.com',
      'user123@gmail.com',
      'user_name@gmail.com',
      'u@gmail.com'
    ];

    for (const validEmail of validEmails) {
      // Re-render for each test to ensure clean state
      const { unmount } = renderWithProviders(<GmailProviderForm {...defaultProps} />);
      
      const emailInput = screen.getByPlaceholderText('support@client.com');
      
      // Type email to trigger validation
      await user.type(emailInput, validEmail);

      // Should not show email validation error for valid emails
      await waitFor(() => {
        expect(screen.queryByText('Valid Gmail address is required')).not.toBeInTheDocument();
      });

      // Clean up for next iteration
      unmount();
      vi.clearAllMocks();
    }
  });

  it('should clear email validation error when corrected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    const emailInput = screen.getByPlaceholderText('support@client.com');
    
    // Type invalid email to trigger validation
    await user.type(emailInput, 'invalid-email');
    
    // Check error appears
    await waitFor(() => {
      expect(screen.getByText('Valid Gmail address is required')).toBeInTheDocument();
    });
    expect(emailInput).toHaveClass('border-red-500');

    // Clear and type valid email
    await user.clear(emailInput);
    await user.type(emailInput, 'valid@gmail.com');

    // Error should disappear after typing valid email
    await waitFor(() => {
      expect(screen.queryByText('Valid Gmail address is required')).not.toBeInTheDocument();
    });
    
    // Border should also update
    expect(emailInput).not.toHaveClass('border-red-500');
  });

  it('should validate email on change', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    const emailInput = screen.getByPlaceholderText('support@client.com');
    
    // Type invalid email
    await user.type(emailInput, 'invalid-email');

    // Check error appears on change without form submission
    await waitFor(() => {
      expect(screen.getByText('Valid Gmail address is required')).toBeInTheDocument();
    });
    expect(emailInput).toHaveClass('border-red-500');
  });

  it('should accept non-gmail.com domain emails for Google Workspace', async () => {
    vi.mocked(emailProviderActions.autoWireEmailProvider).mockResolvedValueOnce({
      success: true,
      provider: { 
        id: '123', 
        tenant: 'test-tenant-123',
        providerType: 'google',
        providerName: 'Test Provider',
        mailbox: 'test@client.com',
        isActive: true,
        status: 'connected',
        vendorConfig: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });

    const user = userEvent.setup();
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    // Fill all fields with valid data including non-gmail email (Google Workspace)
    await user.type(screen.getByPlaceholderText('e.g., Support Gmail'), 'Test Provider');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'test@client.com');
    await user.type(screen.getByPlaceholderText('xxxxxxxxx.apps.googleusercontent.com'), 'test-client-id');
    await user.type(screen.getByPlaceholderText('Enter client secret'), 'test-client-secret');
    await user.type(screen.getByPlaceholderText('my-project-id'), 'test-project-id');
    
    const saveButton = screen.getByText(/add provider/i);
    await user.click(saveButton);

    // Should not show validation error for Google Workspace domains
    await waitFor(() => {
      expect(screen.queryByText('Valid Gmail address is required')).not.toBeInTheDocument();
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
        providerType: 'google',
        providerName: 'Test Gmail Provider',
        mailbox: 'test@gmail.com',
        isActive: true,
        status: 'connected',
        vendorConfig: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });

    const user = userEvent.setup();
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    // Fill in the form
    await user.type(screen.getByPlaceholderText('e.g., Support Gmail'), 'Test Gmail Provider');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'test@gmail.com');
    await user.type(screen.getByPlaceholderText(/\.apps\.googleusercontent\.com/), 'test-client-id');
    await user.type(screen.getByPlaceholderText('Enter client secret'), 'test-client-secret');
    await user.type(screen.getByPlaceholderText('my-project-id'), 'test-project-id');
    // pubSubTopic and pubSubSubscription already have default values

    // Submit the form
    const saveButton = screen.getByText(/add provider/i);
    await user.click(saveButton);

    await waitFor(() => {
      expect(emailProviderActions.autoWireEmailProvider).toHaveBeenCalledWith({
        providerType: 'google',
        config: {
          providerName: 'Test Gmail Provider',
          mailbox: 'test@gmail.com',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          projectId: 'test-project-id',
          pubSubTopic: 'gmail-notifications',
          pubSubSubscription: 'gmail-webhook-subscription',
          labelFilters: ['INBOX'],
          autoProcessEmails: true,
          maxEmailsPerSync: 50,
        },
      });
    });

    expect(mockOnSuccess).toHaveBeenCalledWith(expect.objectContaining({ 
      id: '123', 
      providerType: 'google' 
    }));
  });

  it('should handle API errors', async () => {
    vi.mocked(emailProviderActions.autoWireEmailProvider).mockResolvedValueOnce({
      success: false,
      error: 'API Error'
    });

    const user = userEvent.setup();
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    // Fill in all required fields
    await user.type(screen.getByPlaceholderText('e.g., Support Gmail'), 'Test Gmail Provider');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'test@gmail.com');
    await user.type(screen.getByPlaceholderText('xxxxxxxxx.apps.googleusercontent.com'), 'test-client-id');
    await user.type(screen.getByPlaceholderText('Enter client secret'), 'test-client-secret');
    await user.type(screen.getByPlaceholderText('my-project-id'), 'test-project-id');
    // pubSubTopic and pubSubSubscription already have default values

    const saveButton = screen.getByText(/add provider/i);
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('API Error')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should call onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    const cancelButton = screen.getByText(/cancel/i);
    await user.click(cancelButton);

    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('should populate form when editing existing provider', () => {
    const existingProvider = {
      id: '123',
      tenant: 'test-tenant-123',
      providerType: 'google' as const,
      providerName: 'Existing Gmail',
      mailbox: 'existing@gmail.com',
      isActive: true,
      status: 'connected' as const,
      vendorConfig: {
        clientId: 'existing-client-id',
        clientSecret: '***',
        projectId: 'existing-project-id',
        pubsubTopicName: 'existing-topic',
        pubsubSubscriptionName: 'existing-subscription',
        redirectUri: 'https://test.com/callback',
        labelFilters: ['INBOX', 'IMPORTANT'],
        autoProcessEmails: false,
        maxEmailsPerSync: 100,
      },
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };

    renderWithProviders(<GmailProviderForm {...defaultProps} provider={existingProvider} />);

    expect(screen.getByDisplayValue('Existing Gmail')).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing@gmail.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing-client-id')).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing-project-id')).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing-topic')).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing-subscription')).toBeInTheDocument();
  });

  it('should handle label filter changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    // Check that enable provider switch is selected by default
    const enableSwitch = screen.getByRole('switch', { name: /enable this provider/i });
    expect(enableSwitch).toBeChecked();
  });

  it('should toggle auto-process emails setting', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    const autoProcessSwitch = screen.getByRole('switch', { name: /automatically process new emails/i });
    expect(autoProcessSwitch).toBeChecked(); // Default is true

    await user.click(autoProcessSwitch);
    expect(autoProcessSwitch).not.toBeChecked();
  });

  it('should update max emails per sync', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    const maxEmailsInput = screen.getByDisplayValue(50);
    expect(maxEmailsInput).toHaveValue(50); // Default value

    await user.clear(maxEmailsInput);
    await user.type(maxEmailsInput, '100');
    expect(maxEmailsInput).toHaveValue(100);
  });

  it('should disable submit button when form is invalid', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    const submitButton = screen.getByText(/add provider/i);
    
    // Button should be disabled initially when required fields are empty
    expect(submitButton).toBeDisabled();

    // Fill in some but not all required fields
    await user.type(screen.getByPlaceholderText('e.g., Support Gmail'), 'Test Provider');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'test@gmail.com');
    
    // Button should still be disabled
    expect(submitButton).toBeDisabled();

    // Fill in remaining required fields
    await user.type(screen.getByPlaceholderText('xxxxxxxxx.apps.googleusercontent.com'), 'test-client-id');
    await user.type(screen.getByPlaceholderText('Enter client secret'), 'test-client-secret');
    await user.type(screen.getByPlaceholderText('my-project-id'), 'test-project-id');
    
    // Button should be enabled when all required fields are filled
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
  });

  it('should disable submit button when there are validation errors', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    const submitButton = screen.getByText(/add provider/i);
    const emailInput = screen.getByPlaceholderText('support@client.com');
    
    // Fill all required fields
    await user.type(screen.getByPlaceholderText('e.g., Support Gmail'), 'Test Provider');
    await user.type(emailInput, 'valid@gmail.com');
    await user.type(screen.getByPlaceholderText('xxxxxxxxx.apps.googleusercontent.com'), 'test-client-id');
    await user.type(screen.getByPlaceholderText('Enter client secret'), 'test-client-secret');
    await user.type(screen.getByPlaceholderText('my-project-id'), 'test-project-id');
    
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