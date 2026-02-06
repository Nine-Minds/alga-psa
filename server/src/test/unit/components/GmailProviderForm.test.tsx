/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { GmailProviderForm } from '../../../components/GmailProviderForm';
import { renderWithProviders } from '../../utils/testWrapper';

// Mock server actions
vi.mock('@alga-psa/integrations/actions', () => ({
  createEmailProvider: vi.fn(),
  updateEmailProvider: vi.fn(),
  upsertEmailProvider: vi.fn(),
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getInboundTicketDefaults: vi.fn().mockResolvedValue({ defaults: [] }),
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  initiateEmailOAuth: vi.fn().mockResolvedValue({ success: false, error: 'not used in unit tests' }),
}));

vi.mock('@/lib/actions/integrations/googleActions', () => ({
  getGoogleIntegrationStatus: vi.fn().mockResolvedValue({ success: true, config: { hasServiceAccountKey: true } }),
}));

import * as emailProviderActions from '@alga-psa/integrations/actions';

describe('GmailProviderForm', () => {
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

  it('should render form fields', () => {
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    expect(screen.getByPlaceholderText('e.g., Support Gmail')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('support@client.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('INBOX, Support, Custom Label')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /authorize access/i })).toBeInTheDocument();
  });


  it('should validate email format and show error message', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    await user.type(screen.getByPlaceholderText('e.g., Support Gmail'), 'Test Provider');
    
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
    expect(emailProviderActions.createEmailProvider).not.toHaveBeenCalled();
  });

  it('should submit form with valid data', async () => {
    vi.mocked(emailProviderActions.createEmailProvider).mockResolvedValueOnce({
      provider: {
        id: '123',
        tenant: defaultProps.tenant,
        providerType: 'google',
        providerName: 'Test Gmail Provider',
        mailbox: 'test@gmail.com',
        isActive: true,
        status: 'disconnected',
        googleConfig: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } as any);

    const user = userEvent.setup();
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    await user.type(screen.getByPlaceholderText('e.g., Support Gmail'), 'Test Gmail Provider');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'test@gmail.com');

    await user.click(screen.getByRole('button', { name: /add provider/i }));

    await waitFor(() => {
      expect(emailProviderActions.createEmailProvider).toHaveBeenCalledTimes(1);
    });
    expect(mockOnSuccess).toHaveBeenCalledTimes(1);
  });

  it('should handle API errors', async () => {
    vi.mocked(emailProviderActions.createEmailProvider).mockRejectedValueOnce(new Error('API Error'));

    const user = userEvent.setup();
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    await user.type(screen.getByPlaceholderText('e.g., Support Gmail'), 'Test Gmail Provider');
    await user.type(screen.getByPlaceholderText('support@client.com'), 'test@gmail.com');

    await user.click(screen.getByRole('button', { name: /add provider/i }));

    await waitFor(() => {
      expect(screen.getByText('API Error')).toBeInTheDocument();
    });
  });

  it('should call onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GmailProviderForm {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });
});
