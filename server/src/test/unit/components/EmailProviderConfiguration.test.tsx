/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { EmailProviderConfiguration } from '@alga-psa/integrations/components';

// Mock the server actions
vi.mock('@alga-psa/integrations/actions', () => ({
  getEmailProviders: vi.fn(),
  createEmailProvider: vi.fn(),
  updateEmailProvider: vi.fn(),
  deleteEmailProvider: vi.fn(),
  testEmailProviderConnection: vi.fn(),
  autoWireEmailProvider: vi.fn(),
}));

import * as emailProviderActions from '@alga-psa/integrations/actions';

// Mock the child components
vi.mock('../../../components/MicrosoftProviderForm', () => ({
  MicrosoftProviderForm: ({ onSuccess, onCancel }: any) => (
    <div data-testid="microsoft-form">
      <button onClick={() => onSuccess({ id: '1', providerType: 'microsoft' })}>
        Save Microsoft
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

vi.mock('../../../components/GmailProviderForm', () => ({
  GmailProviderForm: ({ onSuccess, onCancel }: any) => (
    <div data-testid="gmail-form">
      <button onClick={() => onSuccess({ id: '2', providerType: 'google' })}>
        Save Gmail
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

vi.mock('../../../components/EmailProviderList', () => ({
  EmailProviderList: ({ providers, onEdit, onDelete, onTestConnection, onRefresh }: any) => (
    <div data-testid="provider-list">
      {providers.map((provider: any) => (
        <div key={provider.id} data-testid={`provider-${provider.id}`}>
          <span>{provider.providerName}</span>
          <button onClick={() => onEdit(provider)}>Edit</button>
          <button onClick={() => onDelete(provider.id)}>Delete</button>
          <button onClick={() => onTestConnection(provider)}>Test</button>
        </div>
      ))}
      <button onClick={onRefresh}>Refresh</button>
    </div>
  ),
}));

describe('EmailProviderConfiguration', () => {
  const mockTenant = 'test-tenant-123';
  const mockProviders = [
    {
      id: '1',
      tenant: mockTenant,
      providerType: 'microsoft' as const,
      providerName: 'Test Microsoft',
      mailbox: 'test@microsoft.com',
      isActive: true,
      status: 'connected' as const,
      vendorConfig: {},
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    },
    {
      id: '2',
      tenant: mockTenant,
      providerType: 'google' as const,
      providerName: 'Test Gmail',
      mailbox: 'test@gmail.com',
      isActive: true,
      status: 'connected' as const,
      vendorConfig: {},
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should render loading state initially', () => {
    vi.mocked(emailProviderActions.getEmailProviders).mockImplementation(() => new Promise(() => {})); // Never resolves
    
    render(<EmailProviderConfiguration />);
    
    expect(screen.getByText('Loading email providers...')).toBeInTheDocument();
  });

  it('should load and display providers', async () => {
    vi.mocked(emailProviderActions.getEmailProviders).mockResolvedValueOnce(mockProviders);

    render(<EmailProviderConfiguration />);

    await waitFor(() => {
      const providerLists = screen.getAllByTestId('provider-list');
      expect(providerLists.length).toBeGreaterThan(0);
    });

    const microsoftProviders = screen.getAllByText('Test Microsoft');
    const gmailProviders = screen.getAllByText('Test Gmail');
    expect(microsoftProviders.length).toBeGreaterThan(0);
    expect(gmailProviders.length).toBeGreaterThan(0);
    expect(emailProviderActions.getEmailProviders).toHaveBeenCalled();
  });

  it('should show add provider form when button is clicked', async () => {
    vi.mocked(emailProviderActions.getEmailProviders).mockResolvedValueOnce([]);

    const user = userEvent.setup();
    render(<EmailProviderConfiguration />);

    await waitFor(() => {
      const addButtons = screen.getAllByText('Add Email Provider');
      expect(addButtons.length).toBeGreaterThan(0);
    });

    const addButtons = screen.getAllByText('Add Email Provider');
    await user.click(addButtons[0]);

    expect(screen.getByText('Add New Email Provider')).toBeInTheDocument();
    expect(screen.getByText('Microsoft 365')).toBeInTheDocument();
    expect(screen.getByText('Gmail')).toBeInTheDocument();
  });

  it('should switch between Microsoft and Gmail tabs', async () => {
    vi.mocked(emailProviderActions.getEmailProviders).mockResolvedValueOnce([]);

    const user = userEvent.setup();
    render(<EmailProviderConfiguration />);

    await waitFor(() => {
      const addButtons = screen.getAllByText('Add Email Provider');
      expect(addButtons.length).toBeGreaterThan(0);
    });

    const addButtons = screen.getAllByText('Add Email Provider');
    await user.click(addButtons[0]);

    // Microsoft tab should be active by default
    expect(screen.getByTestId('microsoft-form')).toBeInTheDocument();
    expect(screen.queryByTestId('gmail-form')).not.toBeInTheDocument();

    // Click Gmail tab
    await user.click(screen.getByText('Gmail'));

    expect(screen.queryByTestId('microsoft-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('gmail-form')).toBeInTheDocument();
  });

  it('should handle provider deletion', async () => {
    vi.mocked(emailProviderActions.getEmailProviders).mockResolvedValueOnce(mockProviders);
    vi.mocked(emailProviderActions.deleteEmailProvider).mockResolvedValueOnce(undefined);

    const user = userEvent.setup();
    render(<EmailProviderConfiguration />);

    await waitFor(() => {
      expect(screen.getByTestId('provider-1')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByText('Delete');
    await user.click(deleteButtons[0]);

    await waitFor(() => {
      expect(emailProviderActions.deleteEmailProvider).toHaveBeenCalledWith('1');
    });
  });

  it('should handle connection test', async () => {
    vi.mocked(emailProviderActions.getEmailProviders).mockResolvedValueOnce(mockProviders);
    vi.mocked(emailProviderActions.testEmailProviderConnection).mockResolvedValueOnce({
      success: true,
      message: 'Connection successful'
    });

    const user = userEvent.setup();
    render(<EmailProviderConfiguration />);

    await waitFor(() => {
      expect(screen.getByTestId('provider-1')).toBeInTheDocument();
    });

    const testButtons = screen.getAllByText('Test');
    await user.click(testButtons[0]);

    await waitFor(() => {
      expect(emailProviderActions.testEmailProviderConnection).toHaveBeenCalledWith('1');
    });
  });

  it('should display error when loading fails', async () => {
    vi.mocked(emailProviderActions.getEmailProviders).mockRejectedValueOnce(new Error('Network error'));

    render(<EmailProviderConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('should hide add form when cancel is clicked', async () => {
    vi.mocked(emailProviderActions.getEmailProviders).mockResolvedValueOnce([]);

    const user = userEvent.setup();
    render(<EmailProviderConfiguration />);

    await waitFor(() => {
      const addButtons = screen.getAllByText('Add Email Provider');
      expect(addButtons.length).toBeGreaterThan(0);
    });

    const addButtons = screen.getAllByText('Add Email Provider');
    await user.click(addButtons[0]);
    expect(screen.getByText('Add New Email Provider')).toBeInTheDocument();

    await user.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Add New Email Provider')).not.toBeInTheDocument();
  });

  it('should add provider to list when form is submitted', async () => {
    vi.mocked(emailProviderActions.getEmailProviders).mockResolvedValueOnce([]);

    const onProviderAdded = vi.fn();
    const user = userEvent.setup();
    
    render(
      <EmailProviderConfiguration 
        onProviderAdded={onProviderAdded}
      />
    );

    await waitFor(() => {
      const addButtons = screen.getAllByText('Add Email Provider');
      expect(addButtons.length).toBeGreaterThan(0);
    });

    const addButtons = screen.getAllByText('Add Email Provider');
    await user.click(addButtons[0]);
    await user.click(screen.getByText('Save Microsoft'));

    expect(onProviderAdded).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '1',
        providerType: 'microsoft',
      })
    );
  });

  it('should show edit form when edit button is clicked', async () => {
    vi.mocked(emailProviderActions.getEmailProviders).mockResolvedValueOnce(mockProviders);

    const user = userEvent.setup();
    render(<EmailProviderConfiguration />);

    await waitFor(() => {
      expect(screen.getByTestId('provider-1')).toBeInTheDocument();
    });

    const editButtons = screen.getAllByText('Edit');
    await user.click(editButtons[0]);

    expect(screen.getByText('Edit Email Provider')).toBeInTheDocument();
    const updateTexts = screen.getAllByText('Update configuration for Test Microsoft');
    expect(updateTexts.length).toBeGreaterThan(0);
  });

  it('should refresh providers when refresh button is clicked', async () => {
    vi.mocked(emailProviderActions.getEmailProviders)
      .mockResolvedValueOnce(mockProviders)
      .mockResolvedValueOnce([...mockProviders, { 
        id: '3', 
        tenant: mockTenant,
        providerType: 'google',
        providerName: 'New Provider',
        mailbox: 'new@gmail.com',
        isActive: true,
        status: 'connected',
        vendorConfig: {},
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01'
      }]);

    const user = userEvent.setup();
    render(<EmailProviderConfiguration />);

    await waitFor(() => {
      const providerLists = screen.getAllByTestId('provider-list');
      expect(providerLists.length).toBeGreaterThan(0);
    });

    await user.click(screen.getByText('Refresh'));

    expect(emailProviderActions.getEmailProviders).toHaveBeenCalledTimes(2);
  });
});
