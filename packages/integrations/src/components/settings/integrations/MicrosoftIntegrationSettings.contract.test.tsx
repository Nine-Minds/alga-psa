/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const getMicrosoftIntegrationStatusMock = vi.hoisted(() => vi.fn());
const createMicrosoftProfileMock = vi.hoisted(() => vi.fn());
const updateMicrosoftProfileMock = vi.hoisted(() => vi.fn());
const archiveMicrosoftProfileMock = vi.hoisted(() => vi.fn());
const setDefaultMicrosoftProfileMock = vi.hoisted(() => vi.fn());
const resetMicrosoftProvidersToDisconnectedMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/actions', () => ({
  getMicrosoftIntegrationStatus: (...args: unknown[]) => getMicrosoftIntegrationStatusMock(...args),
  createMicrosoftProfile: (...args: unknown[]) => createMicrosoftProfileMock(...args),
  updateMicrosoftProfile: (...args: unknown[]) => updateMicrosoftProfileMock(...args),
  archiveMicrosoftProfile: (...args: unknown[]) => archiveMicrosoftProfileMock(...args),
  setDefaultMicrosoftProfile: (...args: unknown[]) => setDefaultMicrosoftProfileMock(...args),
  resetMicrosoftProvidersToDisconnected: (...args: unknown[]) =>
    resetMicrosoftProvidersToDisconnectedMock(...args),
}));

vi.mock('@alga-psa/ui/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, title }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({
    isOpen,
    title,
    message,
    confirmLabel,
    cancelLabel,
    isConfirming,
    onConfirm,
    onClose,
  }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        <div>{message}</div>
        <button type="button" onClick={onClose}>
          {cancelLabel}
        </button>
        <button type="button" onClick={() => void onConfirm()} disabled={isConfirming}>
          {confirmLabel}
        </button>
      </div>
    ) : null,
}));

import { MicrosoftIntegrationSettings } from './MicrosoftIntegrationSettings';

function buildStatus(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    baseUrl: 'https://psa.example.com',
    redirectUris: {
      email: 'https://psa.example.com/api/auth/microsoft/callback',
      calendar: 'https://psa.example.com/api/auth/microsoft/calendar/callback',
      sso: 'https://psa.example.com/api/auth/callback/azure-ad',
      teamsTab: 'https://psa.example.com/api/teams/auth/callback/tab',
      teamsBot: 'https://psa.example.com/api/teams/auth/callback/bot',
      teamsMessageExtension: 'https://psa.example.com/api/teams/auth/callback/message-extension',
    },
    scopes: {
      email: ['Mail.Read', 'Mail.Send', 'offline_access'],
      calendar: ['Calendars.ReadWrite', 'offline_access'],
      sso: ['openid', 'profile', 'email'],
      teams: ['openid', 'profile', 'email', 'offline_access'],
    },
    config: {
      clientId: 'default-client-id',
      clientSecretMasked: '••••1234',
      tenantId: 'common',
      ready: true,
    },
    profiles: [
      {
        profileId: 'profile-1',
        displayName: 'Primary Profile',
        clientId: 'primary-client-id',
        tenantId: 'tenant-guid-1',
        clientSecretMasked: '••••1234',
        clientSecretConfigured: true,
        clientSecretRef: 'microsoft_profile_profile-1_client_secret',
        isDefault: true,
        isArchived: false,
        readiness: {
          ready: true,
          clientIdConfigured: true,
          clientSecretConfigured: true,
          tenantIdConfigured: true,
          active: true,
        },
        status: 'ready',
        archivedAt: null,
        consumers: ['Email', 'Calendar', 'MSP SSO'],
      },
      {
        profileId: 'profile-2',
        displayName: 'Secondary Profile',
        clientId: 'secondary-client-id',
        tenantId: 'tenant-guid-2',
        clientSecretMasked: undefined,
        clientSecretConfigured: false,
        clientSecretRef: 'microsoft_profile_profile-2_client_secret',
        isDefault: false,
        isArchived: false,
        readiness: {
          ready: false,
          clientIdConfigured: true,
          clientSecretConfigured: false,
          tenantIdConfigured: true,
          active: true,
        },
        status: 'incomplete',
        archivedAt: null,
        consumers: [],
      },
    ],
    ...overrides,
  };
}

describe('MicrosoftIntegrationSettings contracts', () => {
  beforeEach(() => {
    getMicrosoftIntegrationStatusMock.mockReset();
    createMicrosoftProfileMock.mockReset();
    updateMicrosoftProfileMock.mockReset();
    archiveMicrosoftProfileMock.mockReset();
    setDefaultMicrosoftProfileMock.mockReset();
    resetMicrosoftProvidersToDisconnectedMock.mockReset();
    toastMock.mockReset();
    getMicrosoftIntegrationStatusMock.mockResolvedValue(buildStatus());
    createMicrosoftProfileMock.mockResolvedValue({ success: true });
    updateMicrosoftProfileMock.mockResolvedValue({ success: true });
    archiveMicrosoftProfileMock.mockResolvedValue({ success: true });
    setDefaultMicrosoftProfileMock.mockResolvedValue({ success: true });
    resetMicrosoftProvidersToDisconnectedMock.mockResolvedValue({ success: true });
    vi.stubGlobal('open', vi.fn());
  });

  it('T037/T039/T053/T055/T057/T059/T061/T063: renders the profile manager list with readiness, bindings, and registration guidance', async () => {
    const user = userEvent.setup();
    render(<MicrosoftIntegrationSettings />);

    expect(await screen.findByText('Primary Profile')).toBeInTheDocument();
    expect(screen.getByText('Secondary Profile')).toBeInTheDocument();
    expect(screen.getByText('Microsoft Entra')).toBeInTheDocument();
    expect(screen.getAllByText('tenant-guid-1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('tenant-guid-2').length).toBeGreaterThan(0);
    expect(screen.getByText('No current bindings')).toBeInTheDocument();
    expect(screen.getByText('Client secret has not been configured.')).toBeInTheDocument();

    const primaryCard = document.getElementById('microsoft-profile-profile-1');
    expect(primaryCard).not.toBeNull();
    expect(within(primaryCard!).getByText('Email')).toBeInTheDocument();
    expect(within(primaryCard!).getByText('Calendar')).toBeInTheDocument();
    expect(within(primaryCard!).getAllByText('MSP SSO').length).toBeGreaterThan(0);

    const summary = within(primaryCard!).getByText('Microsoft app registration guidance');
    await user.click(summary);

    expect(within(primaryCard!).getAllByText('Teams Redirect URIs').length).toBeGreaterThan(0);
    expect(within(primaryCard!).getByText('Inbound email')).toBeInTheDocument();
    expect(within(primaryCard!).getByText('Calendar sync')).toBeInTheDocument();
    expect(within(primaryCard!).getAllByText('MSP SSO').length).toBeGreaterThan(0);
    expect(within(primaryCard!).getByText('Teams SSO scopes')).toBeInTheDocument();
    expect(within(primaryCard!).getByText('https://psa.example.com/api/teams/auth/callback/tab')).toBeInTheDocument();
  });

  it('T038/T040/T066: shows loading failures as actionable settings errors', async () => {
    getMicrosoftIntegrationStatusMock.mockResolvedValueOnce({
      success: false,
      error: 'Forbidden',
    });

    render(<MicrosoftIntegrationSettings />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Forbidden');
  });

  it('T041/T042/T049/T050/T065/T067: supports empty-state creation, validation, and refresh', async () => {
    const user = userEvent.setup();
    getMicrosoftIntegrationStatusMock
      .mockResolvedValueOnce(buildStatus({ profiles: [], config: { clientId: undefined, clientSecretMasked: undefined, tenantId: 'common', ready: false } }))
      .mockResolvedValueOnce(buildStatus());

    render(<MicrosoftIntegrationSettings />);

    expect(await screen.findByText('No Microsoft profiles yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create Microsoft Profile' }));
    const createDialog = await screen.findByRole('dialog', { name: 'Create Microsoft Profile' });
    await user.click(within(createDialog).getByRole('button', { name: 'Create Profile' }));
    expect(await screen.findByText('Microsoft profile display name is required')).toBeInTheDocument();

    await user.type(within(createDialog).getByPlaceholderText('Acme production tenant'), 'Created Profile');
    await user.type(within(createDialog).getByPlaceholderText('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'), 'created-client-id');
    await user.clear(within(createDialog).getByPlaceholderText('common'));
    await user.type(within(createDialog).getByPlaceholderText('common'), 'created-tenant-id');
    await user.type(within(createDialog).getByPlaceholderText('Enter client secret'), 'created-secret');
    await user.click(within(createDialog).getByRole('button', { name: 'Create Profile' }));

    await waitFor(() => {
      expect(createMicrosoftProfileMock).toHaveBeenCalledWith({
        displayName: 'Created Profile',
        clientId: 'created-client-id',
        clientSecret: 'created-secret',
        tenantId: 'created-tenant-id',
        setAsDefault: true,
      });
    });

    await waitFor(() => {
      expect(getMicrosoftIntegrationStatusMock).toHaveBeenCalledTimes(2);
    });
  });

  it('T043/T044/T051/T052: edits profiles while preserving the stored secret when rotation is omitted', async () => {
    const user = userEvent.setup();
    render(<MicrosoftIntegrationSettings />);

    expect(await screen.findByText('Primary Profile')).toBeInTheDocument();
    const primaryCard = document.getElementById('microsoft-profile-profile-1');
    expect(primaryCard).not.toBeNull();

    await user.click(within(primaryCard!).getByRole('button', { name: 'Edit' }));
    const editDialog = await screen.findByRole('dialog', { name: 'Edit Microsoft Profile' });
    expect(within(editDialog).getByText('Stored secret: ••••1234. Leave this field empty to keep it unchanged.')).toBeInTheDocument();

    const displayNameInput = within(editDialog).getByDisplayValue('Primary Profile');
    await user.clear(displayNameInput);
    await user.type(displayNameInput, 'Primary Profile Updated');

    await user.click(within(editDialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(updateMicrosoftProfileMock).toHaveBeenCalledWith({
        profileId: 'profile-1',
        displayName: 'Primary Profile Updated',
        clientId: 'primary-client-id',
        clientSecret: '',
        tenantId: 'tenant-guid-1',
      });
    });
  });

  it('T045/T046/T069/T070: archive actions require confirmation before the destructive call runs', async () => {
    const user = userEvent.setup();
    render(<MicrosoftIntegrationSettings />);

    expect(await screen.findByText('Secondary Profile')).toBeInTheDocument();
    const secondaryCard = document.getElementById('microsoft-profile-profile-2');
    expect(secondaryCard).not.toBeNull();

    await user.click(within(secondaryCard!).getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('Archive Microsoft profile?')).toBeInTheDocument();
    expect(screen.getByText(/Archive Secondary Profile\?/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Archive Profile' }));

    await waitFor(() => {
      expect(archiveMicrosoftProfileMock).toHaveBeenCalledWith('profile-2');
    });
  });

  it('T047/T048/T054/T068: can set a different default profile and manually refresh masked state', async () => {
    const user = userEvent.setup();
    render(<MicrosoftIntegrationSettings />);

    expect(await screen.findByText('Secondary Profile')).toBeInTheDocument();
    const secondaryCard = document.getElementById('microsoft-profile-profile-2');
    expect(secondaryCard).not.toBeNull();

    await user.click(within(secondaryCard!).getByRole('button', { name: 'Set Default' }));
    await waitFor(() => {
      expect(setDefaultMicrosoftProfileMock).toHaveBeenCalledWith('profile-2');
    });

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(getMicrosoftIntegrationStatusMock).toHaveBeenCalledTimes(3);
    });

    await user.click(screen.getByRole('button', { name: 'Microsoft Entra' }));
    expect(window.open).toHaveBeenCalledWith('https://entra.microsoft.com/', '_blank');
  });

  it('T071/T072: links directly from Microsoft profile management to the Teams setup surface', async () => {
    const user = userEvent.setup();
    window.location.hash = '';

    render(<MicrosoftIntegrationSettings />);

    expect(await screen.findByText('Primary Profile')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Teams Setup' }));

    expect(window.location.hash).toBe('#teams-integration-settings');
  });
});
