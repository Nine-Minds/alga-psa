/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { MicrosoftProviderForm } from '../../../components/MicrosoftProviderForm';

// Mock server actions
vi.mock('../../../lib/actions/email-actions/emailProviderActions', () => ({
  autoWireEmailProvider: vi.fn(),
  updateEmailProvider: vi.fn(),
}));

import * as emailProviderActions from '../../../lib/actions/email-actions/emailProviderActions';

describe('MicrosoftProviderForm', () => {
  const mockOnSuccess = vi.fn();
  const mockOnCancel = vi.fn();

  const defaultProps = {
    onSuccess: mockOnSuccess,
    onCancel: mockOnCancel,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render form fields', () => {
    render(<MicrosoftProviderForm {...defaultProps} />);

    expect(screen.getByLabelText(/provider name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tenant id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/client id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/client secret/i)).toBeInTheDocument();
  });

  it('should show validation errors for empty required fields', async () => {
    const user = userEvent.setup();
    render(<MicrosoftProviderForm {...defaultProps} />);

    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/provider name is required/i)).toBeInTheDocument();
      expect(screen.getByText(/email address is required/i)).toBeInTheDocument();
      expect(screen.getByText(/tenant id is required/i)).toBeInTheDocument();
      expect(screen.getByText(/client id is required/i)).toBeInTheDocument();
      expect(screen.getByText(/client secret is required/i)).toBeInTheDocument();
    });
  });

  it('should validate email format', async () => {
    const user = userEvent.setup();
    render(<MicrosoftProviderForm {...defaultProps} />);

    const emailInput = screen.getByLabelText(/email address/i);
    await user.type(emailInput, 'invalid-email');
    
    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid email address/i)).toBeInTheDocument();
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
    render(<MicrosoftProviderForm {...defaultProps} />);

    // Fill in the form
    await user.type(screen.getByLabelText(/provider name/i), 'Test Microsoft Provider');
    await user.type(screen.getByLabelText(/email address/i), 'test@microsoft.com');
    await user.type(screen.getByLabelText(/tenant id/i), 'test-tenant-id');
    await user.type(screen.getByLabelText(/client id/i), 'test-client-id');
    await user.type(screen.getByLabelText(/client secret/i), 'test-client-secret');

    // Submit the form
    const saveButton = screen.getByRole('button', { name: /save/i });
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
    render(<MicrosoftProviderForm {...defaultProps} />);

    // Fill in required fields
    await user.type(screen.getByLabelText(/provider name/i), 'Test Provider');
    await user.type(screen.getByLabelText(/email address/i), 'test@microsoft.com');
    await user.type(screen.getByLabelText(/tenant id/i), 'test-tenant-id');
    await user.type(screen.getByLabelText(/client id/i), 'test-client-id');
    await user.type(screen.getByLabelText(/client secret/i), 'test-client-secret');

    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/API Error/i)).toBeInTheDocument();
    });
  });

  it('should call onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup();
    render(<MicrosoftProviderForm {...defaultProps} />);

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
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

    render(<MicrosoftProviderForm {...defaultProps} provider={existingProvider} />);

    expect(screen.getByDisplayValue('Existing Microsoft')).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing@microsoft.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing-tenant-id')).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing-client-id')).toBeInTheDocument();
  });

  it('should handle folder filter changes', async () => {
    const user = userEvent.setup();
    render(<MicrosoftProviderForm {...defaultProps} />);

    // Check that Inbox is selected by default
    const inboxCheckbox = screen.getByRole('checkbox', { name: /inbox/i });
    expect(inboxCheckbox).toBeChecked();

    // Toggle Sent Items folder
    const sentItemsCheckbox = screen.getByRole('checkbox', { name: /sent items/i });
    await user.click(sentItemsCheckbox);
    expect(sentItemsCheckbox).toBeChecked();

    // Uncheck Inbox
    await user.click(inboxCheckbox);
    expect(inboxCheckbox).not.toBeChecked();
  });

  it('should toggle auto-process emails setting', async () => {
    const user = userEvent.setup();
    render(<MicrosoftProviderForm {...defaultProps} />);

    const autoProcessSwitch = screen.getByRole('checkbox', { name: /auto-process emails/i });
    expect(autoProcessSwitch).toBeChecked(); // Default is true

    await user.click(autoProcessSwitch);
    expect(autoProcessSwitch).not.toBeChecked();
  });

  it('should update max emails per sync', async () => {
    const user = userEvent.setup();
    render(<MicrosoftProviderForm {...defaultProps} />);

    const maxEmailsInput = screen.getByLabelText(/max emails per sync/i);
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
    render(<MicrosoftProviderForm {...defaultProps} />);

    // Fill in required fields
    await user.type(screen.getByLabelText(/provider name/i), 'Test Provider');
    await user.type(screen.getByLabelText(/email address/i), 'test@microsoft.com');
    await user.type(screen.getByLabelText(/tenant id/i), 'test-tenant-id');
    await user.type(screen.getByLabelText(/client id/i), 'test-client-id');
    await user.type(screen.getByLabelText(/client secret/i), 'test-client-secret');

    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/authorization required/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/authorization code/i)).toBeInTheDocument();
    });
  });
});