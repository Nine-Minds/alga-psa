/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailProvider } from './types';

const getEmailProvidersMock = vi.hoisted(() => vi.fn());
const resyncImapProviderMock = vi.hoisted(() => vi.fn());
const isEnterpriseEditionMock = vi.hoisted(() => vi.fn(() => true));
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), {
  error: vi.fn(),
  loading: vi.fn(() => 'resync-toast'),
  success: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ default: toastMock }));

vi.mock('../../actions/email-actions/emailProviderActions', () => ({
  deleteEmailProvider: vi.fn(),
  getEmailProviders: (...args: unknown[]) => getEmailProvidersMock(...args),
  resyncImapProvider: (...args: unknown[]) => resyncImapProviderMock(...args),
  retryMicrosoftSubscriptionRenewal: vi.fn(),
  testEmailProviderConnection: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ tenant: 'tenant-1' }),
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getMicrosoftConsumerSetupStatus: vi.fn().mockResolvedValue({
    success: true,
    emailSetup: null,
  }),
}));

vi.mock('@alga-psa/integrations/email/providers/entry', () => ({
  GmailProviderForm: () => null,
  ImapProviderForm: () => null,
  MicrosoftProviderForm: () => null,
}));

vi.mock('@alga-psa/ui', () => ({
  DrawerOutlet: () => null,
  DrawerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDrawer: () => ({ closeDrawer: vi.fn(), openDrawer: vi.fn() }),
}));

vi.mock('./ProviderSetupWizardDialog', () => ({
  ProviderSetupWizardDialog: () => null,
}));

vi.mock('./admin/InboundTicketDefaultsManager', () => ({
  InboundTicketDefaultsManager: () => null,
}));

vi.mock('./admin/InboundEmailRulesManager', () => ({
  InboundEmailRulesManager: () => null,
}));

vi.mock('./admin/Microsoft365DiagnosticsDialog', () => ({
  Microsoft365DiagnosticsDialog: () => null,
}));

vi.mock('../../lib/microsoftConsumerVisibility', () => ({
  isMicrosoftConsumerEnterpriseEdition: () => isEnterpriseEditionMock(),
}));

vi.mock('./EmailProviderList', () => ({
  EmailProviderList: ({
    providers,
    reconnectingProviderIds,
    onResyncProvider,
  }: {
    providers: EmailProvider[];
    reconnectingProviderIds: ReadonlySet<string>;
    onResyncProvider: (provider: EmailProvider) => Promise<void>;
  }) => {
    const provider = providers[0];
    if (!provider) {
      return <div>No providers</div>;
    }
    const reconnecting = reconnectingProviderIds.has(provider.id);
    return (
      <div>
        <div data-testid="provider-presentation">
          {reconnecting
            ? 'Reconnecting'
            : provider.status === 'connected'
              ? 'Connected'
              : 'Disconnected'}
        </div>
        <button
          id="test-resync-provider"
          type="button"
          disabled={reconnecting}
          onClick={() => void onResyncProvider(provider)}
        >
          Resync Mailbox
        </button>
      </div>
    );
  },
}));

import { EmailProviderCard } from './EmailProviderCard';
import { EmailProviderConfiguration } from './EmailProviderConfiguration';

const connectedProvider: EmailProvider = {
  id: 'imap-provider-1',
  tenant: 'tenant-1',
  providerType: 'imap',
  providerName: 'Support inbox',
  mailbox: 'support@example.com',
  isActive: true,
  status: 'connected',
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  imapConfig: {
    email_provider_id: 'imap-provider-1',
    tenant: 'tenant-1',
    host: 'imap.example.com',
    port: 993,
    secure: true,
    allow_starttls: true,
    auth_type: 'password',
    username: 'support@example.com',
    folder_filters: ['INBOX'],
    auto_process_emails: true,
    max_emails_per_sync: 100,
    created_at: '2026-08-01T12:00:00.000Z',
    updated_at: '2026-08-01T12:00:00.000Z',
  },
};

const disconnectedProvider: EmailProvider = {
  ...connectedProvider,
  status: 'disconnected',
};

async function renderConfiguration() {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<EmailProviderConfiguration />);
  });
  return result;
}

async function startResync() {
  fireEvent.click(screen.getByRole('button', { name: 'Resync Mailbox' }));
  await act(async () => {});
}

describe('IMAP resync status recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resyncImapProviderMock.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows Reconnecting immediately and automatically presents a freshly connected provider', async () => {
    getEmailProvidersMock
      .mockResolvedValueOnce({ providers: [connectedProvider] })
      .mockResolvedValueOnce({ providers: [disconnectedProvider] })
      .mockResolvedValueOnce({ providers: [connectedProvider] });

    await renderConfiguration();
    await startResync();

    expect(screen.getByTestId('provider-presentation')).toHaveTextContent('Reconnecting');
    expect(screen.getByRole('button', { name: 'Resync Mailbox' })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByTestId('provider-presentation')).toHaveTextContent('Connected');
    expect(toastMock.success).toHaveBeenCalledWith('Support inbox reconnected successfully.');
  });

  it('stops polling when the component unmounts', async () => {
    getEmailProvidersMock.mockResolvedValue({ providers: [disconnectedProvider] });
    getEmailProvidersMock.mockResolvedValueOnce({ providers: [connectedProvider] });

    const view = await renderConfiguration();
    await startResync();
    expect(getEmailProvidersMock).toHaveBeenCalledTimes(2);

    view.unmount();
    await vi.advanceTimersByTimeAsync(300_000);

    expect(getEmailProvidersMock).toHaveBeenCalledTimes(2);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('keeps presenting Reconnecting beyond 90 seconds and recovers after the observed 102.6-second cycle', async () => {
    const recoversAt = Date.now() + 102_600;
    getEmailProvidersMock
      .mockResolvedValueOnce({ providers: [connectedProvider] })
      .mockImplementation(() => Promise.resolve({
        providers: [Date.now() >= recoversAt ? connectedProvider : disconnectedProvider],
      }));

    await renderConfiguration();
    await startResync();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });

    expect(screen.getByTestId('provider-presentation')).toHaveTextContent('Reconnecting');
    expect(toastMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(screen.getByTestId('provider-presentation')).toHaveTextContent('Reconnecting');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByTestId('provider-presentation')).toHaveTextContent('Connected');
    expect(toastMock.success).toHaveBeenCalledWith('Support inbox reconnected successfully.');
  });

  it('backs off after the expected recovery window while continuing to poll', async () => {
    getEmailProvidersMock.mockResolvedValue({ providers: [disconnectedProvider] });
    getEmailProvidersMock.mockResolvedValueOnce({ providers: [connectedProvider] });

    await renderConfiguration();
    await startResync();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    const callsAfterFastPolling = getEmailProvidersMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
    });
    expect(getEmailProvidersMock).toHaveBeenCalledTimes(callsAfterFastPolling);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getEmailProvidersMock).toHaveBeenCalledTimes(callsAfterFastPolling + 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(165_000);
    });
    const callsAfterBackoffPolling = getEmailProvidersMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_999);
    });
    expect(getEmailProvidersMock).toHaveBeenCalledTimes(callsAfterBackoffPolling);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getEmailProvidersMock).toHaveBeenCalledTimes(callsAfterBackoffPolling + 1);
    expect(screen.getByTestId('provider-presentation')).toHaveTextContent('Reconnecting');
  });

  it('does not reload or poll after a failed resync request', async () => {
    getEmailProvidersMock.mockResolvedValue({ providers: [connectedProvider] });
    resyncImapProviderMock.mockResolvedValue({ success: false, error: 'Resync failed' });

    await renderConfiguration();
    await startResync();
    await vi.advanceTimersByTimeAsync(300_000);

    expect(getEmailProvidersMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('provider-presentation')).toHaveTextContent('Connected');
    expect(toastMock.error).toHaveBeenCalledWith('Resync failed', { id: 'resync-toast' });
  });

  it('renders the reconnecting card without inactive styling and blocks duplicate actions', () => {
    const view = render(
      <EmailProviderCard
        provider={disconnectedProvider}
        reconnecting
        defaultsOptions={[]}
        updatingProviderId={null}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onTestConnection={vi.fn()}
        onRefreshWatchSubscription={vi.fn()}
        onRetryRenewal={vi.fn()}
        onResyncProvider={vi.fn()}
        onRunDiagnostics={vi.fn()}
        onReconnect={vi.fn()}
        onChangeDefaults={vi.fn()}
        onTogglePause={vi.fn()}
      />
    );

    expect(screen.getAllByText('Reconnecting')).toHaveLength(2);
    expect(screen.queryByText('Inactive')).not.toBeInTheDocument();
    expect(view.container.firstElementChild).not.toHaveClass('opacity-60');
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('EmailProviderConfiguration setup guidance across editions', () => {
  afterEach(() => {
    cleanup();
    isEnterpriseEditionMock.mockImplementation(() => true);
  });

  it('shows the Microsoft setup guidance without the hosted Providers hint in CE', async () => {
    isEnterpriseEditionMock.mockImplementation(() => false);
    getEmailProvidersMock.mockResolvedValueOnce({ providers: [] });

    await act(async () => {
      render(<EmailProviderConfiguration />);
    });

    // Edition-neutral bring-your-own-app guidance renders in every edition.
    expect(screen.getByText(/Bring your own Microsoft app/)).toBeInTheDocument();
    // The hosted/platform-credentials Providers hint stays EE-only.
    expect(screen.queryByText('Microsoft app setup is managed in Providers.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Providers' })).not.toBeInTheDocument();
  });

  it('shows the hosted Providers hint alongside the setup guidance in EE', async () => {
    isEnterpriseEditionMock.mockImplementation(() => true);
    getEmailProvidersMock.mockResolvedValueOnce({ providers: [] });

    await act(async () => {
      render(<EmailProviderConfiguration />);
    });

    expect(screen.getByText(/Bring your own Microsoft app/)).toBeInTheDocument();
    expect(screen.getByText('Microsoft app setup is managed in Providers.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Providers' })).toBeInTheDocument();
  });
});
