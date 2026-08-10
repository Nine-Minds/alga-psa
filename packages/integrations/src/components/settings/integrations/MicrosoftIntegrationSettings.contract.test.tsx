/**
 * @vitest-environment jsdom
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
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
const getMicrosoftEmailSetupOptionsMock = vi.hoisted(() => vi.fn());
const configureMicrosoftEmailPlatformApplicationMock = vi.hoisted(() => vi.fn());
const createMicrosoftEmailApplicationMock = vi.hoisted(() => vi.fn());
const configureMicrosoftEmailManualApplicationMock = vi.hoisted(() => vi.fn());
const getMicrosoftEmailAdminConsentUrlMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

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

vi.mock('../../../actions/integrations/microsoftActions', () => ({
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

vi.mock('../../../actions/integrations/microsoftEmailSetupActions', () => ({
  getMicrosoftEmailSetupOptions: (...args: unknown[]) => getMicrosoftEmailSetupOptionsMock(...args),
  configureMicrosoftEmailPlatformApplication: (...args: unknown[]) => configureMicrosoftEmailPlatformApplicationMock(...args),
  createMicrosoftEmailApplication: (...args: unknown[]) => createMicrosoftEmailApplicationMock(...args),
  configureMicrosoftEmailManualApplication: (...args: unknown[]) => configureMicrosoftEmailManualApplicationMock(...args),
  getMicrosoftEmailAdminConsentUrl: (...args: unknown[]) => getMicrosoftEmailAdminConsentUrlMock(...args),
}));

vi.mock('@alga-psa/ui/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: (...args: unknown[]) => useFeatureFlagMock(...args),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, title, footer }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
        {footer}
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
        <option value="">Select an app</option>
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
    emailSetup: {
      state: 'ready',
      source: 'tenant_app',
      hosted: true,
      platformOffered: true,
      automatedCreationAvailable: true,
      profileId: 'profile-1',
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
        capabilities: ['msp_sso', 'email', 'calendar', 'teams'],
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
        capabilities: ['email', 'calendar'],
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
        capabilities: ['msp_sso', 'email', 'calendar', 'teams'],
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
    getMicrosoftEmailSetupOptionsMock.mockReset().mockResolvedValue({
      success: true,
      callbackUri: 'https://psa.example.com/api/auth/microsoft/callback',
      setupCallbackUri: 'https://psa.example.com/api/auth/microsoft/email-setup/callback',
      emailSetup: {
        state: 'not_configured',
        source: null,
        hosted: true,
        platformOffered: false,
        automatedCreationAvailable: false,
      },
      platformApplication: { available: false },
      automatedCreationAvailable: false,
    });
    configureMicrosoftEmailPlatformApplicationMock.mockReset();
    createMicrosoftEmailApplicationMock.mockReset();
    configureMicrosoftEmailManualApplicationMock.mockReset();
    getMicrosoftEmailAdminConsentUrlMock.mockReset();
    toastMock.mockReset();
    routerPushMock.mockReset();
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

  it('renders EE service binding controls and removes the legacy compatibility pane', async () => {
    render(<MicrosoftIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('microsoft-profile-profile-1')).not.toBeNull();
    });
    expect(screen.getByText('Which Microsoft app each service uses')).toBeInTheDocument();
    expect(screen.getByTestId('microsoft-binding-select-msp_sso')).toBeInTheDocument();
    expect(screen.getByTestId('microsoft-binding-select-email')).toBeInTheDocument();
    expect(screen.getByTestId('microsoft-binding-select-calendar')).toBeInTheDocument();
    expect(screen.getByTestId('microsoft-binding-select-teams')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect Microsoft providers' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Teams Setup' })).not.toBeInTheDocument();
    expect(screen.queryByText('Legacy Microsoft consumers')).not.toBeInTheDocument();
    expect(screen.queryByText(/default active profile remains the compatibility source/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Current consumers')).not.toBeInTheDocument();
    expect(screen.queryByText(/default profile\)/i)).not.toBeInTheDocument();
    expect(screen.getAllByText('Values to copy into Microsoft Entra').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Staff sign-in').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Outlook email').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Outlook Calendar').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Teams').length).toBeGreaterThan(0);
    expect(screen.queryByText('MSP SSO')).not.toBeInTheDocument();
  });

  it('keeps tenant app management collapsed when hosted platform credentials are ready', async () => {
    const user = userEvent.setup();
    getMicrosoftIntegrationStatusMock.mockResolvedValue(buildStatus({
      emailSetup: {
        state: 'ready',
        source: 'platform',
        hosted: true,
        platformOffered: true,
        automatedCreationAvailable: true,
      },
    }));

    render(<MicrosoftIntegrationSettings />);

    expect(await screen.findByText('Microsoft email is ready to connect')).toBeInTheDocument();
    expect(screen.queryByText('Which Microsoft app each service uses')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New app registration' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Manual Microsoft apps/i }));

    expect(screen.getByText(/custom Entra app is normally unnecessary/i)).toBeInTheDocument();
    expect(screen.getByText('Which Microsoft app each service uses')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New app registration' })).toBeInTheDocument();
  });

  it('opens inbound email provider configuration from the hosted Microsoft CTA', async () => {
    const user = userEvent.setup();
    getMicrosoftIntegrationStatusMock.mockResolvedValue(buildStatus({
      emailSetup: {
        state: 'ready',
        source: 'platform',
        hosted: true,
        platformOffered: true,
        automatedCreationAvailable: true,
      },
    }));

    render(<MicrosoftIntegrationSettings />);

    await user.click(await screen.findByRole('button', { name: 'Connect a mailbox →' }));

    expect(routerPushMock).toHaveBeenCalledWith('/msp/settings/integrations?category=communication');
  });

  it('does not offer the platform app when the server reports a self-hosted deployment', async () => {
    const user = userEvent.setup();
    getMicrosoftIntegrationStatusMock.mockResolvedValue(buildStatus({
      emailSetup: {
        state: 'not_configured',
        source: null,
        hosted: false,
        platformOffered: false,
        automatedCreationAvailable: false,
      },
    }));

    render(<MicrosoftIntegrationSettings />);

    await user.click(await screen.findByRole('button', { name: 'Set up Microsoft' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set up Microsoft' });
    expect(within(dialog).queryByRole('button', { name: /Use the app provided by AlgaPSA/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Enter an existing app manually/ })).toBeEnabled();
  });

  it('lists the hosted platform app first and marks it Recommended', async () => {
    const user = userEvent.setup();
    const emailSetup = {
      state: 'not_configured',
      source: null,
      hosted: true,
      platformOffered: true,
      automatedCreationAvailable: true,
    };
    getMicrosoftIntegrationStatusMock.mockResolvedValue(buildStatus({ emailSetup }));
    getMicrosoftEmailSetupOptionsMock.mockResolvedValue({
      success: true,
      callbackUri: 'https://psa.example.com/api/auth/microsoft/callback',
      setupCallbackUri: 'https://psa.example.com/api/auth/microsoft/email-setup/callback',
      emailSetup,
      platformApplication: { available: true },
      automatedCreationAvailable: true,
    });

    render(<MicrosoftIntegrationSettings />);
    await user.click(await screen.findByRole('button', { name: 'Set up Microsoft' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set up Microsoft' });
    const platformChoice = within(dialog).getByRole('button', { name: /Use the app provided by AlgaPSA/ });
    const automatedChoice = within(dialog).getByRole('button', { name: /Create an app in your Microsoft organization/ });

    expect(within(platformChoice).getByText('Recommended')).toBeInTheDocument();
    expect(platformChoice.compareDocumentPosition(automatedChoice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows approval actions instead of setup while Microsoft consent is pending', async () => {
    getMicrosoftIntegrationStatusMock.mockResolvedValue(buildStatus({
      emailSetup: {
        state: 'pending_admin_consent',
        source: 'tenant_app',
        hosted: true,
        platformOffered: true,
        automatedCreationAvailable: true,
        profileId: 'profile-pending',
      },
    }));

    render(<MicrosoftIntegrationSettings />);

    expect(await screen.findByText('Waiting for admin approval')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve in Microsoft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy approval link for your admin' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up Microsoft' })).not.toBeInTheDocument();
  });

  it('keeps the manual fallback usable when automated setup is unavailable', async () => {
    const user = userEvent.setup();
    getMicrosoftIntegrationStatusMock.mockResolvedValue(buildStatus({
      emailSetup: {
        state: 'not_configured',
        source: null,
        hosted: true,
        platformOffered: false,
        automatedCreationAvailable: false,
      },
    }));
    render(<MicrosoftIntegrationSettings />);

    await user.click(await screen.findByRole('button', { name: 'Set up Microsoft' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set up Microsoft' });
    const automatedChoice = within(dialog).getByRole('button', { name: /Create an app in your Microsoft organization/ });
    const manualChoice = within(dialog).getByRole('button', { name: /Enter an existing app manually/ });

    expect(within(dialog).queryByRole('button', { name: /Use the app provided by AlgaPSA/ })).not.toBeInTheDocument();
    expect(automatedChoice).toBeDisabled();
    expect(manualChoice).toBeEnabled();

    await user.click(manualChoice);
    expect(within(dialog).getByLabelText('Redirect URI to add in Entra')).toHaveAttribute('readonly');
  });

  it('recovers the automated setup controls when the Microsoft popup is closed', async () => {
    const user = userEvent.setup();
    const popup = { closed: false, focus: vi.fn(), close: vi.fn() };
    vi.stubGlobal('open', vi.fn(() => popup));
    getMicrosoftEmailSetupOptionsMock.mockResolvedValue({
      success: true,
      callbackUri: 'https://psa.example.com/api/auth/microsoft/callback',
      setupCallbackUri: 'https://psa.example.com/api/auth/microsoft/email-setup/callback',
      emailSetup: {
        state: 'not_configured',
        source: null,
        hosted: false,
        platformOffered: false,
        automatedCreationAvailable: true,
      },
      platformApplication: { available: false },
      automatedCreationAvailable: true,
    });
    createMicrosoftEmailApplicationMock.mockResolvedValue({
      success: true,
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    });
    getMicrosoftIntegrationStatusMock.mockResolvedValue(buildStatus({
      emailSetup: {
        state: 'not_configured',
        source: null,
        hosted: false,
        platformOffered: false,
        automatedCreationAvailable: true,
      },
    }));

    render(<MicrosoftIntegrationSettings />);
    await user.click(await screen.findByRole('button', { name: 'Set up Microsoft' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set up Microsoft' });
    await user.click(within(dialog).getByRole('button', { name: /Create an app in your Microsoft organization/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Sign in to Microsoft' }));
    expect(within(dialog).getByRole('button', { name: 'Working…' })).toBeDisabled();

    popup.closed = true;

    expect(await within(dialog).findByText(
      'The Microsoft window was closed before setup finished. Try again or choose another setup option.',
      {},
      { timeout: 2_000 }
    )).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Back' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Sign in to Microsoft' })).toBeEnabled();
  });

  it('keeps guided Microsoft Email setup and binding reachable in CE', async () => {
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
          email: 'https://psa.example.com/api/auth/microsoft/callback',
        },
        scopes: {
          sso: ['openid', 'profile', 'email'],
          email: ['Mail.Read', 'Mail.Read.Shared', 'offline_access'],
        },
        emailSetup: {
          state: 'not_configured',
          source: null,
          hosted: false,
          platformOffered: false,
          automatedCreationAvailable: false,
        },
        profiles: [
          {
            ...buildStatus().profiles[0],
            consumers: ['MSP SSO', 'Email'],
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
        {
          consumerType: 'email',
          consumerLabel: 'Email',
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
      screen.getByText("Manage your company's Microsoft app registrations for staff sign-in and Outlook email.")
    ).toBeInTheDocument();
    expect(screen.getByTestId('microsoft-binding-select-msp_sso')).toBeInTheDocument();
    expect(screen.getByTestId('microsoft-binding-select-email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up Microsoft' })).toBeInTheDocument();
    expect(screen.queryByText('Calendar sync redirect URI')).not.toBeInTheDocument();
    expect(screen.queryByText('Teams scopes')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect Microsoft providers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Teams Setup' })).not.toBeInTheDocument();
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

    const teamsSelect = screen.getByTestId('microsoft-binding-select-teams');
    const teamsOptionLabels = within(teamsSelect).getAllByRole('option').map((option) => option.textContent);
    expect(teamsOptionLabels).toContain('Primary Profile');
    expect(teamsOptionLabels).not.toContain('Secondary Profile');

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

    expect(screen.getAllByText('Current: Primary Profile.').length).toBeGreaterThan(0);
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
          title: 'Outlook email app choice updated',
          description: expect.stringContaining(
            'Existing Outlook email connections need re-authorization to grant Mail.Send before they can send outbound email.'
          ),
        })
      );
    });

    await user.selectOptions(screen.getByTestId('microsoft-binding-select-calendar'), 'profile-2');

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Outlook Calendar app choice updated',
          description: expect.stringContaining(
            'Existing Outlook calendar connections may need re-authorization after changing the Microsoft app.'
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
    await user.click(screen.getByRole('button', { name: 'New app registration' }));

    const createDialog = await screen.findByRole('dialog', { name: 'Create Microsoft app registration' });
    expect(
      within(createDialog).getByText(
        'Create a Microsoft app registration, then choose which services can use it.'
      )
    ).toBeInTheDocument();
    expect(within(createDialog).getByText('Set this as the default Microsoft app')).toBeInTheDocument();
    expect(within(createDialog).getByText('Services this app can handle')).toBeInTheDocument();
    expect(within(createDialog).getByLabelText('Outlook email')).toBeChecked();
    expect(within(createDialog).getByLabelText('Outlook Calendar')).toBeChecked();
    expect(
      within(createDialog).getByText(
        'Some setup flows still need a default app. Service choices above decide which app each service uses.'
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
    const editDialog = await screen.findByRole('dialog', { name: 'Edit Microsoft app registration' });
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
        capabilities: ['msp_sso', 'email', 'calendar', 'teams'],
      });
    });

    await user.click(within(secondaryCard!).getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('Archive Microsoft app?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archive app' }));

    await waitFor(() => {
      expect(archiveMicrosoftProfileMock).toHaveBeenCalledWith('profile-2');
    });
  });

  it('loads status with the email issuer backfill opt-in (the email settings flow still backfills)', async () => {
    render(<MicrosoftIntegrationSettings />);

    await waitFor(() => {
      expect(getMicrosoftIntegrationStatusMock).toHaveBeenCalled();
    });
    expect(getMicrosoftIntegrationStatusMock).toHaveBeenCalledWith({ runIssuerBackfill: true });
  });

  it('contract: only the Microsoft email settings page opts into the email issuer backfill', () => {
    const filePath = path.resolve(__dirname, 'MicrosoftIntegrationSettings.tsx');
    const teamsFilePath = path.resolve(__dirname, 'TeamsIntegrationSettings.tsx');
    const source = fs.readFileSync(filePath, 'utf8');
    const teamsSource = fs.readFileSync(teamsFilePath, 'utf8');

    // The Microsoft email settings page explicitly opts into the backfill.
    expect(source).toContain('getMicrosoftIntegrationStatus({ runIssuerBackfill: true })');
    // The Teams settings page shares the status action only to build its
    // profile picker and must remain a pure read (no backfill writes).
    expect(teamsSource).toContain('getMicrosoftIntegrationStatus()');
    expect(teamsSource).not.toContain('runIssuerBackfill');
  });
});
