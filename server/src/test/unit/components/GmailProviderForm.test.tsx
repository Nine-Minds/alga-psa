/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { GmailProviderForm } from '../../../components/GmailProviderForm';

// Mock server actions
vi.mock('../../../lib/actions/email-actions/emailProviderActions', () => ({
  autoWireEmailProvider: vi.fn(),
  updateEmailProvider: vi.fn(),
}));

import * as emailProviderActions from '../../../lib/actions/email-actions/emailProviderActions';

describe('GmailProviderForm', () => {
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
    render(<GmailProviderForm {...defaultProps} />);

    expect(screen.getByLabelText(/provider name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/client id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/client secret/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/project id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/pub\/sub topic/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/pub\/sub subscription/i)).toBeInTheDocument();
  });

  it('should show validation errors for empty required fields', async () => {
    const user = userEvent.setup();
    render(<GmailProviderForm {...defaultProps} />);

    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/provider name is required/i)).toBeInTheDocument();
      expect(screen.getByText(/email address is required/i)).toBeInTheDocument();
      expect(screen.getByText(/client id is required/i)).toBeInTheDocument();
      expect(screen.getByText(/client secret is required/i)).toBeInTheDocument();
    });
  });

  it('should validate email format', async () => {
    const user = userEvent.setup();
    render(<GmailProviderForm {...defaultProps} />);

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
    render(<GmailProviderForm {...defaultProps} />);

    // Fill in the form
    await user.type(screen.getByLabelText(/provider name/i), 'Test Gmail Provider');
    await user.type(screen.getByLabelText(/email address/i), 'test@gmail.com');
    await user.type(screen.getByLabelText(/client id/i), 'test-client-id');
    await user.type(screen.getByLabelText(/client secret/i), 'test-client-secret');
    await user.type(screen.getByLabelText(/project id/i), 'test-project-id');
    await user.type(screen.getByLabelText(/pub\/sub topic/i), 'gmail-notifications');
    await user.type(screen.getByLabelText(/pub\/sub subscription/i), 'gmail-webhook-subscription');

    // Submit the form
    const saveButton = screen.getByRole('button', { name: /save/i });
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
    render(<GmailProviderForm {...defaultProps} />);

    // Fill in required fields
    await user.type(screen.getByLabelText(/provider name/i), 'Test Gmail Provider');
    await user.type(screen.getByLabelText(/email address/i), 'test@gmail.com');
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
    render(<GmailProviderForm {...defaultProps} />);

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
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
        pubSubTopic: 'existing-topic',
        pubSubSubscription: 'existing-subscription',
        labelFilters: ['INBOX', 'IMPORTANT'],
        autoProcessEmails: false,
        maxEmailsPerSync: 100,
      },
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };

    render(<GmailProviderForm {...defaultProps} provider={existingProvider} />);

    expect(screen.getByDisplayValue('Existing Gmail')).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing@gmail.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing-client-id')).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing-project-id')).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing-topic')).toBeInTheDocument();
    expect(screen.getByDisplayValue('existing-subscription')).toBeInTheDocument();
  });

  it('should handle label filter changes', async () => {
    const user = userEvent.setup();
    render(<GmailProviderForm {...defaultProps} />);

    // Check that INBOX is selected by default
    const inboxCheckbox = screen.getByRole('checkbox', { name: /inbox/i });
    expect(inboxCheckbox).toBeChecked();

    // Toggle IMPORTANT label
    const importantCheckbox = screen.getByRole('checkbox', { name: /important/i });
    await user.click(importantCheckbox);
    expect(importantCheckbox).toBeChecked();

    // Uncheck INBOX
    await user.click(inboxCheckbox);
    expect(inboxCheckbox).not.toBeChecked();
  });

  it('should toggle auto-process emails setting', async () => {
    const user = userEvent.setup();
    render(<GmailProviderForm {...defaultProps} />);

    const autoProcessSwitch = screen.getByRole('checkbox', { name: /auto-process emails/i });
    expect(autoProcessSwitch).toBeChecked(); // Default is true

    await user.click(autoProcessSwitch);
    expect(autoProcessSwitch).not.toBeChecked();
  });

  it('should update max emails per sync', async () => {
    const user = userEvent.setup();
    render(<GmailProviderForm {...defaultProps} />);

    const maxEmailsInput = screen.getByLabelText(/max emails per sync/i);
    expect(maxEmailsInput).toHaveValue(50); // Default value

    await user.clear(maxEmailsInput);
    await user.type(maxEmailsInput, '100');
    expect(maxEmailsInput).toHaveValue(100);
  });
});