/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';

// The component reads the edition at render time; force EE so Microsoft
// providers stay visible/editable in these tests.
process.env.NEXT_PUBLIC_EDITION = 'enterprise';

// Mock the server actions module the component actually imports
// (deep path, not the @alga-psa/integrations/actions barrel).
vi.mock('@alga-psa/integrations/actions/email-actions/emailProviderActions', () => ({
  getEmailProviders: vi.fn(),
  deleteEmailProvider: vi.fn(),
  testEmailProviderConnection: vi.fn(),
  resyncImapProvider: vi.fn(),
  retryMicrosoftSubscriptionRenewal: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'user-1', tenant: 'test-tenant-123' }),
}));

// useFeatureFlag depends on next-auth's useSession and PostHog; neither
// provider exists in unit tests.
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
  SessionProvider: ({ children }: any) => children,
}));

vi.mock('posthog-js/react', () => ({
  usePostHog: () => undefined,
  PostHogProvider: ({ children }: any) => children,
}));

// Mock the provider form components (loaded through the CE/EE entry module)
vi.mock('@alga-psa/integrations/email/providers/entry', () => ({
  MicrosoftProviderForm: ({ onSuccess, onCancel }: any) => (
    <div data-testid="microsoft-form">
      <button onClick={() => onSuccess({ id: '1', providerType: 'microsoft' })}>
        Save Microsoft
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
  GmailProviderForm: ({ onSuccess, onCancel }: any) => (
    <div data-testid="gmail-form">
      <button onClick={() => onSuccess({ id: '2', providerType: 'google' })}>
        Save Gmail
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
  ImapProviderForm: ({ onSuccess, onCancel }: any) => (
    <div data-testid="imap-form">
      <button onClick={() => onSuccess({ id: '3', providerType: 'imap' })}>
        Save IMAP
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

vi.mock('@alga-psa/integrations/components/email/EmailProviderList', () => ({
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

// The add flow now goes through a setup wizard dialog.
vi.mock('@alga-psa/integrations/components/email/ProviderSetupWizardDialog', () => ({
  ProviderSetupWizardDialog: ({ isOpen, onClose, onComplete }: any) =>
    isOpen ? (
      <div data-testid="setup-wizard">
        <button onClick={() => onComplete({ id: '1', providerType: 'microsoft' })}>
          Complete Wizard
        </button>
        <button onClick={onClose}>Close Wizard</button>
      </div>
    ) : null,
}));

// Heavy admin surfaces that are not under test here
vi.mock('@alga-psa/integrations/components/email/admin/InboundTicketDefaultsManager', () => ({
  InboundTicketDefaultsManager: () => <div data-testid="defaults-manager" />,
}));
vi.mock('@alga-psa/integrations/components/email/admin/InboundEmailRulesManager', () => ({
  InboundEmailRulesManager: () => <div data-testid="rules-manager" />,
}));
vi.mock('@alga-psa/integrations/components/email/admin/Microsoft365DiagnosticsDialog', () => ({
  Microsoft365DiagnosticsDialog: () => null,
}));

// Lightweight drawer implementation so edit flows render inline.
vi.mock('@alga-psa/ui/context/DrawerContext', async () => {
  const ReactModule = await import('react');
  const R = ReactModule.default ?? ReactModule;
  const DrawerCtx = R.createContext<any>(null);

  function DrawerProvider({ children }: any) {
    const [content, setContent] = R.useState<React.ReactNode>(null);
    const api = R.useMemo(
      () => ({
        openDrawer: (c: React.ReactNode) => setContent(c),
        replaceDrawer: (c: React.ReactNode) => setContent(c),
        closeDrawer: () => setContent(null),
        goBack: () => {},
        goForward: () => {},
        canGoBack: false,
        canGoForward: false,
        currentEntry: null,
        history: [],
        openListDrawer: () => {},
        openDetailDrawer: () => {},
        openFormDrawer: () => {},
      }),
      []
    );
    return R.createElement(DrawerCtx.Provider, { value: { api, content } }, children);
  }

  function DrawerOutlet() {
    const value = R.useContext(DrawerCtx);
    return value?.content ?? null;
  }

  function useDrawer() {
    const value = R.useContext(DrawerCtx);
    return value.api;
  }

  return { DrawerProvider, DrawerOutlet, useDrawer };
});

import { EmailProviderConfiguration } from '@alga-psa/integrations/components';
import * as emailProviderActions from '@alga-psa/integrations/actions/email-actions/emailProviderActions';

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
      microsoftConfig: {},
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
      googleConfig: {},
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('should render loading state initially', () => {
    vi.mocked(emailProviderActions.getEmailProviders).mockImplementation(() => new Promise(() => {})); // Never resolves

    render(<EmailProviderConfiguration />);

    expect(screen.getByText('Loading email providers...')).toBeInTheDocument();
  });

  it('should load and display providers', async () => {
    vi.mocked(emailProviderActions.getEmailProviders).mockResolvedValueOnce({ providers: mockProviders } as any);

    render(<EmailProviderConfiguration />);

    await waitFor(() => {
      const providerLists = screen.getAllByTestId('provider-list');
      expect(providerLists.length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('Test Microsoft').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Test Gmail').length).toBeGreaterThan(0);
    expect(emailProviderActions.getEmailProviders).toHaveBeenCalled();
  });

  it('should open the setup wizard when add provider button is clicked', async () => {
    vi.mocked(emailProviderActions.getEmailProviders).mockResolvedValueOnce({ providers: [] } as any);

    const user = userEvent.setup();
    render(<EmailProviderConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Add Email Provider')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('setup-wizard')).not.toBeInTheDocument();

    await user.click(screen.getByText('Add Email Provider'));

    expect(screen.getByTestId('setup-wizard')).toBeInTheDocument();
  });

  it('should close the setup wizard when it is dismissed', async () => {
    vi.mocked(emailProviderActions.getEmailProviders).mockResolvedValueOnce({ providers: [] } as any);

    const user = userEvent.setup();
    render(<EmailProviderConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Add Email Provider')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Add Email Provider'));
    expect(screen.getByTestId('setup-wizard')).toBeInTheDocument();

    await user.click(screen.getByText('Close Wizard'));
    expect(screen.queryByTestId('setup-wizard')).not.toBeInTheDocument();
  });

  it('should notify and reload providers when the wizard completes', async () => {
    vi.mocked(emailProviderActions.getEmailProviders).mockResolvedValue({ providers: [] } as any);

    const onProviderAdded = vi.fn();
    const user = userEvent.setup();

    render(<EmailProviderConfiguration onProviderAdded={onProviderAdded} />);

    await waitFor(() => {
      expect(screen.getByText('Add Email Provider')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Add Email Provider'));
    await user.click(screen.getByText('Complete Wizard'));

    expect(onProviderAdded).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '1',
        providerType: 'microsoft',
      })
    );

    // Initial load + reload after wizard completion
    await waitFor(() => {
      expect(emailProviderActions.getEmailProviders).toHaveBeenCalledTimes(2);
    });
  });

  it('should handle provider deletion', async () => {
    vi.mocked(emailProviderActions.getEmailProviders).mockResolvedValueOnce({ providers: mockProviders } as any);
    vi.mocked(emailProviderActions.deleteEmailProvider).mockResolvedValueOnce(undefined as any);

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
    vi.mocked(emailProviderActions.getEmailProviders).mockResolvedValueOnce({ providers: mockProviders } as any);
    vi.mocked(emailProviderActions.testEmailProviderConnection).mockResolvedValueOnce({
      success: true,
      message: 'Connection successful',
    } as any);

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

  it('should show edit drawer when edit button is clicked', async () => {
    vi.mocked(emailProviderActions.getEmailProviders).mockResolvedValueOnce({ providers: mockProviders } as any);

    const user = userEvent.setup();
    render(<EmailProviderConfiguration />);

    await waitFor(() => {
      expect(screen.getByTestId('provider-1')).toBeInTheDocument();
    });

    const editButtons = screen.getAllByText('Edit');
    await user.click(editButtons[0]);

    expect(screen.getByText('Edit Email Provider')).toBeInTheDocument();
    expect(screen.getByTestId('microsoft-form')).toBeInTheDocument();
  });

  it('should refresh providers when refresh button is clicked', async () => {
    vi.mocked(emailProviderActions.getEmailProviders)
      .mockResolvedValueOnce({ providers: mockProviders } as any)
      .mockResolvedValueOnce({
        providers: [
          ...mockProviders,
          {
            id: '3',
            tenant: mockTenant,
            providerType: 'google',
            providerName: 'New Provider',
            mailbox: 'new@gmail.com',
            isActive: true,
            status: 'connected',
            googleConfig: {},
            createdAt: '2024-01-01',
            updatedAt: '2024-01-01',
          },
        ],
      } as any);

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
