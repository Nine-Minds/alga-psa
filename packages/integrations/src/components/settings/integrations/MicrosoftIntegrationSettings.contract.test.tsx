/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const useFeatureFlagMock = vi.hoisted(() => vi.fn());
const getMicrosoftIntegrationStatusMock = vi.hoisted(() => vi.fn());
const listMicrosoftConsumerBindingsMock = vi.hoisted(() => vi.fn());
const setMicrosoftConsumerBindingMock = vi.hoisted(() => vi.fn());
const createMicrosoftProfileMock = vi.hoisted(() => vi.fn());
const updateMicrosoftProfileMock = vi.hoisted(() => vi.fn());
const archiveMicrosoftProfileMock = vi.hoisted(() => vi.fn());
const setDefaultMicrosoftProfileMock = vi.hoisted(() => vi.fn());
const resetMicrosoftProvidersToDisconnectedMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/actions', () => ({
  getMicrosoftIntegrationStatus: (...args: unknown[]) => getMicrosoftIntegrationStatusMock(...args),
  listMicrosoftConsumerBindings: (...args: unknown[]) => listMicrosoftConsumerBindingsMock(...args),
  setMicrosoftConsumerBinding: (...args: unknown[]) => setMicrosoftConsumerBindingMock(...args),
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

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: (...args: unknown[]) => useFeatureFlagMock(...args),
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

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, label, options, value, onValueChange, disabled }: any) => (
    <label>
      <span>{label}</span>
      <select
        data-testid={id}
        aria-label={label}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
      >
        <option value="">Select a profile</option>
        {options.map((option: any) => (
          <option key={option.value} value={option.value}>
            {typeof option.label === 'string' ? option.label : option.value}
          </option>
        ))}
      </select>
    </label>
  ),
}));

import { MicrosoftIntegrationSettings } from './MicrosoftIntegrationSettings';

function buildStatus(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    baseUrl: 'https://psa.example.com',
    redirectUris: {
      sso: 'https://psa.example.com/api/auth/callback/azure-ad',
      email: 'https://psa.example.com/api/auth/microsoft/callback',
      calendar: 'https://psa.example.com/api/auth/microsoft/calendar/callback',
      teamsTab: 'https://psa.example.com/api/teams/auth/callback/tab',
      teamsBot: 'https://psa.example.com/api/teams/auth/callback/bot',
      teamsMessageExtension: 'https://psa.example.com/api/teams/auth/callback/message-extension',
    },
    scopes: {
      sso: ['openid', 'profile', 'email'],
      email: ['Mail.Read', 'Mail.Send', 'offline_access'],
      calendar: ['Calendars.ReadWrite', 'offline_access'],
      teams: ['openid', 'profile', 'email', 'offline_access'],
    },
    config: {
      clientId: 'primary-client-id',
      clientSecretMasked: '••••1234',
      tenantId: 'tenant-guid-1',
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
        consumers: ['MSP SSO', 'Email', 'Calendar', 'Teams'],
      },
      {
        profileId: 'profile-2',
        displayName: 'Secondary Profile',
        clientId: 'secondary-client-id',
        tenantId: 'tenant-guid-2',
        clientSecretMasked: '••••4321',
        clientSecretConfigured: true,
        clientSecretRef: 'microsoft_profile_profile-2_client_secret',
        isDefault: false,
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
        consumers: ['Email'],
      },
      {
        profileId: 'profile-archived',
        displayName: 'Archived Profile',
        clientId: 'archived-client-id',
        tenantId: 'tenant-guid-3',
        clientSecretMasked: '••••9999',
        clientSecretConfigured: true,
        clientSecretRef: 'microsoft_profile_profile-archived_client_secret',
        isDefault: false,
        isArchived: true,
        readiness: {
          ready: false,
          clientIdConfigured: true,
          clientSecretConfigured: true,
          tenantIdConfigured: true,
          active: false,
        },
        status: 'archived',
        archivedAt: '2026-03-08T00:00:00.000Z',
        consumers: [],
      },
    ],
    ...overrides,
  };
}

function buildBindings(overrides: Array<Record<string, unknown>> | null = null) {
  if (overrides) {
    return overrides;
  }

  return [
    {
      consumerType: 'msp_sso',
      consumerLabel: 'MSP SSO',
      profileId: 'profile-1',
      profileDisplayName: 'Primary Profile',
      isArchived: false,
    },
    {
      consumerType: 'email',
      consumerLabel: 'Email',
      profileId: 'profile-1',
      profileDisplayName: 'Primary Profile',
      isArchived: false,
    },
    {
      consumerType: 'calendar',
      consumerLabel: 'Calendar',
      profileId: 'profile-1',
      profileDisplayName: 'Primary Profile',
      isArchived: false,
    },
    {
      consumerType: 'teams',
      consumerLabel: 'Teams',
      profileId: 'profile-1',
      profileDisplayName: 'Primary Profile',
      isArchived: false,
    },
  ];
}

describe('MicrosoftIntegrationSettings contracts', () => {
  const originalEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    useFeatureFlagMock.mockReset();
    useFeatureFlagMock.mockReturnValue({
      enabled: true,
      isLoading: false,
      error: null,
      value: true,
    });
    getMicrosoftIntegrationStatusMock.mockReset();
    listMicrosoftConsumerBindingsMock.mockReset();
    setMicrosoftConsumerBindingMock.mockReset();
    createMicrosoftProfileMock.mockReset();
    updateMicrosoftProfileMock.mockReset();
    archiveMicrosoftProfileMock.mockReset();
    setDefaultMicrosoftProfileMock.mockReset();
    resetMicrosoftProvidersToDisconnectedMock.mockReset();
    toastMock.mockReset();
    getMicrosoftIntegrationStatusMock.mockResolvedValue(buildStatus());
    listMicrosoftConsumerBindingsMock.mockResolvedValue({
      success: true,
      bindings: buildBindings(),
    });
    setMicrosoftConsumerBindingMock.mockResolvedValue({
      success: true,
      binding: {
        consumerType: 'email',
        consumerLabel: 'Email',
        profileId: 'profile-2',
        profileDisplayName: 'Secondary Profile',
        isArchived: false,
      },
    });
    createMicrosoftProfileMock.mockResolvedValue({ success: true });
    updateMicrosoftProfileMock.mockResolvedValue({ success: true });
    archiveMicrosoftProfileMock.mockResolvedValue({ success: true });
    setDefaultMicrosoftProfileMock.mockResolvedValue({ success: true });
    resetMicrosoftProvidersToDisconnectedMock.mockResolvedValue({ success: true });
    vi.stubGlobal('open', vi.fn());
  });

  afterEach(() => {
    if (originalEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalEdition;
    }
  });

  it('renders EE explicit binding controls and removes the legacy compatibility pane', async () => {
    render(<MicrosoftIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('microsoft-profile-profile-1')).not.toBeNull();
    });
    expect(screen.getByText('Explicit consumer bindings')).toBeInTheDocument();
    expect(screen.getByTestId('microsoft-binding-select-msp_sso')).toBeInTheDocument();
    expect(screen.getByTestId('microsoft-binding-select-email')).toBeInTheDocument();
    expect(screen.getByTestId('microsoft-binding-select-calendar')).toBeInTheDocument();
    expect(screen.getByTestId('microsoft-binding-select-teams')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset Microsoft Providers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Teams Setup' })).toBeInTheDocument();
    expect(screen.queryByText('Legacy Microsoft consumers')).not.toBeInTheDocument();
    expect(screen.queryByText(/default active profile remains the compatibility source/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Current consumers')).not.toBeInTheDocument();
    expect(screen.queryByText(/default profile\)/i)).not.toBeInTheDocument();
    expect(screen.getAllByText('Email Guidance').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Calendar Guidance').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Teams Guidance').length).toBeGreaterThan(0);
  });

  it('renders CE copy and bindings only for MSP SSO', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    useFeatureFlagMock.mockReturnValue({
      enabled: false,
      isLoading: false,
      error: null,
      value: false,
    });
    getMicrosoftIntegrationStatusMock.mockResolvedValueOnce(
      buildStatus({
        redirectUris: {
          sso: 'https://psa.example.com/api/auth/callback/azure-ad',
        },
        scopes: {
          sso: ['openid', 'profile', 'email'],
        },
        profiles: [
          {
            ...buildStatus().profiles[0],
            consumers: ['MSP SSO'],
          },
        ],
      })
    );
    listMicrosoftConsumerBindingsMock.mockResolvedValueOnce({
      success: true,
      bindings: buildBindings([
        {
          consumerType: 'msp_sso',
          consumerLabel: 'MSP SSO',
          profileId: 'profile-1',
          profileDisplayName: 'Primary Profile',
          isArchived: false,
        },
      ]),
    });

    render(<MicrosoftIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('microsoft-profile-profile-1')).not.toBeNull();
    });
    expect(
      screen.getByText('Manage tenant-owned Microsoft profiles for MSP SSO, Microsoft sign-in, and login-domain discovery.')
    ).toBeInTheDocument();
    expect(screen.getByTestId('microsoft-binding-select-msp_sso')).toBeInTheDocument();
    expect(screen.queryByText('Email Guidance')).not.toBeInTheDocument();
    expect(screen.queryByText('Calendar Guidance')).not.toBeInTheDocument();
    expect(screen.queryByText('Teams Guidance')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset Microsoft Providers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Teams Setup' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('microsoft-binding-select-email')).not.toBeInTheDocument();
    expect(screen.queryByTestId('microsoft-binding-select-calendar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('microsoft-binding-select-teams')).not.toBeInTheDocument();
  });

  it('excludes archived profiles from binding choices and updates one consumer binding at a time', async () => {
    const user = userEvent.setup();
    render(<MicrosoftIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('microsoft-profile-profile-1')).not.toBeNull();
    });

    const emailSelect = screen.getByTestId('microsoft-binding-select-email');
    const optionLabels = within(emailSelect).getAllByRole('option').map((option) => option.textContent);
    expect(optionLabels).toContain('Primary Profile');
    expect(optionLabels).toContain('Secondary Profile');
    expect(optionLabels).not.toContain('Archived Profile');

    await user.selectOptions(emailSelect, '');
    expect(setMicrosoftConsumerBindingMock).not.toHaveBeenCalled();

    await user.selectOptions(emailSelect, 'profile-2');

    await waitFor(() => {
      expect(setMicrosoftConsumerBindingMock).toHaveBeenCalledWith({
        consumerType: 'email',
        profileId: 'profile-2',
      });
    });
  });

  it('T353/T354: binding summaries stop presenting the selected profile as a routing default', async () => {
    render(<MicrosoftIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('microsoft-profile-profile-1')).not.toBeNull();
    });

    expect(screen.getByText('MSP SSO is bound to Primary Profile.')).toBeInTheDocument();
    expect(screen.queryByText('MSP SSO is bound to Primary Profile (default profile).')).not.toBeInTheDocument();
  });

  it('prompts reconnection guidance after email and calendar bindings change', async () => {
    const user = userEvent.setup();
    setMicrosoftConsumerBindingMock
      .mockResolvedValueOnce({
        success: true,
        binding: {
          consumerType: 'email',
          consumerLabel: 'Email',
          profileId: 'profile-2',
          profileDisplayName: 'Secondary Profile',
          isArchived: false,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        binding: {
          consumerType: 'calendar',
          consumerLabel: 'Calendar',
          profileId: 'profile-2',
          profileDisplayName: 'Secondary Profile',
          isArchived: false,
        },
      });

    render(<MicrosoftIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('microsoft-profile-profile-1')).not.toBeNull();
    });

    await user.selectOptions(screen.getByTestId('microsoft-binding-select-email'), 'profile-2');

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Email binding updated',
          description: expect.stringContaining(
            'Existing Outlook email connections may need re-authorization after changing the bound profile.'
          ),
        })
      );
    });

    await user.selectOptions(screen.getByTestId('microsoft-binding-select-calendar'), 'profile-2');

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Calendar binding updated',
          description: expect.stringContaining(
            'Existing Microsoft calendar connections may need re-authorization after changing the bound profile.'
          ),
        })
      );
    });
  });

  it('uses explicit-binding copy in the create dialog instead of compatibility wording', async () => {
    const user = userEvent.setup();
    render(<MicrosoftIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('microsoft-profile-profile-1')).not.toBeNull();
    });
    await user.click(screen.getByRole('button', { name: 'New Profile' }));

    const createDialog = await screen.findByRole('dialog', { name: 'Create Microsoft Profile' });
    expect(
      within(createDialog).getByText(
        'Create a tenant-owned Microsoft profile, then bind it explicitly to the Microsoft consumers you want to use.'
      )
    ).toBeInTheDocument();
    expect(within(createDialog).getByText('Set this profile as the default Microsoft profile')).toBeInTheDocument();
    expect(
      within(createDialog).getByText(
        'Default profiles stay available for profile-management workflows and migration-safe metadata, not consumer routing.'
      )
    ).toBeInTheDocument();
    expect(within(createDialog).queryByText(/compatibility profile/i)).not.toBeInTheDocument();
  });

  it('keeps edit and archive profile actions wired through the updated UI', async () => {
    const user = userEvent.setup();
    render(<MicrosoftIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('microsoft-profile-profile-1')).not.toBeNull();
    });
    const primaryCard = document.getElementById('microsoft-profile-profile-1');
    const secondaryCard = document.getElementById('microsoft-profile-profile-2');
    expect(primaryCard).not.toBeNull();
    expect(secondaryCard).not.toBeNull();

    await user.click(within(primaryCard!).getByRole('button', { name: 'Edit' }));
    const editDialog = await screen.findByRole('dialog', { name: 'Edit Microsoft Profile' });
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

    await user.click(within(secondaryCard!).getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('Archive Microsoft profile?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archive Profile' }));

    await waitFor(() => {
      expect(archiveMicrosoftProfileMock).toHaveBeenCalledWith('profile-2');
    });
  });
});
