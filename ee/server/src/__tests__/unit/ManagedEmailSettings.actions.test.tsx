// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import emailProvidersEn from 'server/public/locales/en/msp/email-providers.json';
import ManagedEmailSettings from '@ee/components/settings/email/ManagedEmailSettings';

const {
  getManagedEmailDomainsMock,
  requestManagedEmailDomainMock,
  refreshManagedEmailDomainMock,
  deleteManagedEmailDomainMock,
  getEmailSettingsMock,
  updateEmailSettingsMock,
  getEmailProvidersMock,
  testOutboundEmailMock,
  getMicrosoftOutboundMailboxesMock,
  toastSuccessMock,
  toastErrorMock,
  tierContextState,
} = vi.hoisted(() => ({
  getManagedEmailDomainsMock: vi.fn(),
  requestManagedEmailDomainMock: vi.fn(),
  refreshManagedEmailDomainMock: vi.fn(),
  deleteManagedEmailDomainMock: vi.fn(),
  getEmailSettingsMock: vi.fn(),
  updateEmailSettingsMock: vi.fn(),
  getEmailProvidersMock: vi.fn(),
  testOutboundEmailMock: vi.fn(),
  getMicrosoftOutboundMailboxesMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  tierContextState: { isHosted: true },
}));

vi.mock('@ee/lib/actions/email-actions/managedDomainActions', () => ({
  getManagedEmailDomains: getManagedEmailDomainsMock,
  requestManagedEmailDomain: requestManagedEmailDomainMock,
  refreshManagedEmailDomain: refreshManagedEmailDomainMock,
  deleteManagedEmailDomain: deleteManagedEmailDomainMock,
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getEmailSettings: getEmailSettingsMock,
  updateEmailSettings: updateEmailSettingsMock,
  getEmailProviders: getEmailProvidersMock,
  testOutboundEmail: testOutboundEmailMock,
  getMicrosoftOutboundMailboxes: getMicrosoftOutboundMailboxesMock,
}));

vi.mock('@alga-psa/email/providerConfig', () => ({
  createDefaultProviderConfig: (
    providerType: 'smtp' | 'resend',
    { isEnabled }: { isEnabled: boolean }
  ) => ({
    providerId: `${providerType}-provider`,
    providerType,
    isEnabled,
    config: providerType === 'smtp'
      ? { host: '', port: 587, username: '', password: '', from: '' }
      : { apiKey: '', from: '' },
  }),
}));

vi.mock('server/src/context/TierContext', () => ({
  useTier: () => ({ hasFeature: () => true, isHosted: tierContextState.isHosted }),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

vi.mock('@alga-psa/integrations/components', () => ({
  EmailProviderConfiguration: () => <div id="email-provider-configuration-stub" />,
  OutboundEmailDiagnosticsDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="outbound-diagnostics-dialog" /> : null,
  EmailSenderIdentityCards: ({
    copy,
    ticketAddress,
    ticketAddressDomain,
    ticketFieldsDisabled,
    ticketAddressReadOnly,
    ticketError,
    notificationFieldsDisabled,
    showNotificationCard = true,
    ticketName,
    notificationAddress,
    notificationName,
    onTicketAddressChange,
    onTicketNameChange,
    onNotificationAddressChange,
    onNotificationNameChange,
    actions,
  }: any) => (
    <div>
      <h2>{copy.ticketTitle}</h2>
      {ticketError && <p role="alert">{ticketError}</p>}
      <input
        id="ticket-from-address"
        data-domain={ticketAddressDomain}
        disabled={ticketFieldsDisabled}
        readOnly={ticketAddressReadOnly}
        value={ticketAddress}
        onChange={(event) => onTicketAddressChange(event.target.value)}
      />
      <input
        id="ticket-from-name"
        disabled={ticketFieldsDisabled}
        value={ticketName}
        onChange={(event) => onTicketNameChange(event.target.value)}
      />
      {showNotificationCard && <>
      <h2>{copy.notificationTitle}</h2>
      <input
        id="notification-from-address"
        disabled={notificationFieldsDisabled}
        value={notificationAddress}
        onChange={(event) => onNotificationAddressChange(event.target.value)}
      />
      <input
        id="notification-from-name"
        disabled={notificationFieldsDisabled}
        value={notificationName}
        onChange={(event) => onNotificationNameChange(event.target.value)}
      />
      </>}
      {actions}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({
    isOpen,
    title,
    message,
    onClose,
    onConfirm,
    id,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
  }: {
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    onClose: () => void;
    onConfirm: () => void;
    id?: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }) =>
    isOpen ? (
      <div data-testid={id || 'confirmation-dialog'}>
        <div>{title}</div>
        <div>{message}</div>
        <button id={`${id}-close`} onClick={onClose}>
          {cancelLabel}
        </button>
        <button id={`${id}-confirm`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    ) : null,
}));

vi.mock('@alga-psa/ui/components/Tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    id,
    disabled,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    id?: string;
  }) => (
    <input
      id={id}
      type="checkbox"
      disabled={disabled}
      checked={!!checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({
    value,
    options,
    onValueChange,
    placeholder,
    id,
    disabled,
  }: {
    value?: string;
    options: Array<{ value: string; label: string }>;
    onValueChange?: (value: string) => void;
    placeholder?: string;
    id?: string;
    disabled?: boolean;
  }) => (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@ee/components/settings/email/DnsRecordInstructions', () => ({
  default: () => <div id="dns-record-instructions-stub" />,
}));

const baseSettings = {
  tenantId: 'tenant-123',
  defaultFromDomain: 'acme.com',
  ticketingFromEmail: 'support@acme.com',
  customDomains: [],
  emailProvider: 'resend' as const,
  providerConfigs: [],
  trackingEnabled: false,
  createdAt: new Date('2026-03-01T00:00:00.000Z'),
  updatedAt: new Date('2026-03-01T00:00:00.000Z'),
  tenantCompanyName: 'Acme MSP',
  effectiveNotificationFrom: {
    email: 'notifications@acme.com',
    name: 'Acme MSP',
  },
};

const smtpSettings = {
  ...baseSettings,
  emailProvider: 'smtp' as const,
  providerConfigs: [
    {
      providerId: 'smtp-provider',
      providerType: 'smtp' as const,
      isEnabled: true,
      config: {
        host: 'relay.lan',
        port: 587,
        username: '',
        password: '',
        from: 'noreply@acme.com',
      },
    },
  ],
};

beforeAll(() => {
  // The shared test setup initializes i18next with empty resources; load the
  // real English namespace so assertions can target user-visible strings.
  i18n.addResourceBundle('en', 'msp/email-providers', emailProvidersEn, true, true);
});

describe('ManagedEmailSettings removal actions', () => {
  beforeEach(() => {
    getManagedEmailDomainsMock.mockReset();
    requestManagedEmailDomainMock.mockReset();
    refreshManagedEmailDomainMock.mockReset();
    deleteManagedEmailDomainMock.mockReset();
    getEmailSettingsMock.mockReset();
    updateEmailSettingsMock.mockReset();
    getEmailProvidersMock.mockReset();
    testOutboundEmailMock.mockReset();
    getMicrosoftOutboundMailboxesMock.mockReset();
    getMicrosoftOutboundMailboxesMock.mockResolvedValue({ mailboxes: [] });
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    tierContextState.isHosted = true;

    getManagedEmailDomainsMock.mockResolvedValue([
      {
        domain: 'acme.com',
        status: 'verified',
        dnsRecords: [],
      },
    ]);
    getEmailSettingsMock.mockResolvedValue(baseSettings);
    getEmailProvidersMock.mockResolvedValue({
      providers: [{ id: 'provider-1', mailbox: 'support@acme.com' }],
    });
  });

  it('does not expose a thrown English domain-loading error', async () => {
    getManagedEmailDomainsMock.mockRejectedValue(new Error('Secret backend trace'));

    render(<ManagedEmailSettings />);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Failed to load managed domains');
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith('Secret backend trace');
  });

  it('stages clearing the ticket identity until the outbound settings are saved', async () => {
    updateEmailSettingsMock.mockResolvedValue({
      ...baseSettings,
      ticketingFromEmail: null,
    });

    render(<ManagedEmailSettings />);

    const clearButton = await screen.findByRole('button', { name: /clear ticket identity/i });
    fireEvent.click(clearButton);
    const confirmButton = document.getElementById('managed-email-clear-ticketing-from-confirm');
    expect(confirmButton).not.toBeNull();
    fireEvent.click(confirmButton as HTMLElement);

    expect(updateEmailSettingsMock).not.toHaveBeenCalled();
    expect(document.getElementById('ticket-from-address')).toHaveValue('');
    fireEvent.click(document.getElementById('save-outbound-settings')!);

    await waitFor(() => {
      expect(updateEmailSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketingFromEmail: null,
        })
      );
    });
  });

  it('locks outbound editing and saving until domain removal and identity cleanup finish', async () => {
    let finishRemoval!: (value: { success: boolean }) => void;
    let finishCleanup!: (value: Omit<typeof baseSettings, 'ticketingFromEmail' | 'defaultFromDomain'> & { ticketingFromEmail: null; defaultFromDomain: undefined }) => void;
    deleteManagedEmailDomainMock.mockImplementationOnce(() => new Promise(resolve => { finishRemoval = resolve; }));
    updateEmailSettingsMock.mockImplementationOnce(() => new Promise(resolve => { finishCleanup = resolve; }));
    render(<ManagedEmailSettings />);
    fireEvent.click(await screen.findByRole('button', { name: /remove domain/i }));
    fireEvent.click(document.getElementById('managed-email-remove-domain-confirm')!);

    expect(deleteManagedEmailDomainMock).toHaveBeenCalledTimes(1);
    const lockedControls = ['outbound-provider-select', 'ticket-from-address', 'ticket-from-name',
      'notification-from-name', 'save-outbound-settings', 'discard-outbound-changes', 'open-outbound-diagnostics'];
    for (const id of lockedControls) expect(document.getElementById(id), id).toBeDisabled();
    fireEvent.click(document.getElementById('save-outbound-settings')!);
    expect(updateEmailSettingsMock).not.toHaveBeenCalled();

    await act(async () => finishRemoval({ success: true }));
    expect(updateEmailSettingsMock).toHaveBeenCalledTimes(1);
    expect(updateEmailSettingsMock).toHaveBeenCalledWith({ defaultFromDomain: null, ticketingFromEmail: null });
    for (const id of lockedControls) expect(document.getElementById(id), id).toBeDisabled();

    await act(async () => finishCleanup({ ...baseSettings, ticketingFromEmail: null, defaultFromDomain: undefined }));
    expect(document.getElementById('outbound-provider-select')).toBeEnabled();
    expect(document.getElementById('ticket-from-address')).toHaveValue('');
    expect(document.getElementById('outbound-save-status')).toHaveTextContent('No unsaved changes');
    expect(updateEmailSettingsMock).toHaveBeenCalledTimes(1);
  });

  it('preserves pending edits and refuses domain removal until they are saved or discarded', async () => {
    render(<ManagedEmailSettings />);
    const remove = await screen.findByRole('button', { name: /remove domain/i });
    fireEvent.change(document.getElementById('ticket-from-name')!, { target: { value: 'Pending Support' } });
    fireEvent.click(remove);
    fireEvent.click(document.getElementById('managed-email-remove-domain-confirm')!);

    expect(deleteManagedEmailDomainMock).not.toHaveBeenCalled();
    expect(updateEmailSettingsMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('Save or discard your outbound changes before removing a domain.');
    expect(document.getElementById('ticket-from-name')).toHaveValue('Pending Support');
    expect(document.getElementById('ticket-from-address')).toHaveValue('support@acme.com');
    expect(document.getElementById('outbound-save-status')).toHaveTextContent(/^Unsaved changes$/);
  });

  it('removing the active managed domain also clears the saved ticketing from address', async () => {
    deleteManagedEmailDomainMock.mockResolvedValue({ success: true });
    getManagedEmailDomainsMock
      .mockResolvedValueOnce([
        {
          domain: 'acme.com',
          status: 'verified',
          dnsRecords: [],
        },
      ])
      .mockResolvedValueOnce([]);
    updateEmailSettingsMock.mockResolvedValue({
      ...baseSettings,
      defaultFromDomain: undefined,
      ticketingFromEmail: null,
    });

    render(<ManagedEmailSettings />);

    const removeButton = await screen.findByRole('button', { name: /remove domain/i });
    fireEvent.click(removeButton);
    const confirmButton = document.getElementById('managed-email-remove-domain-confirm');
    expect(confirmButton).not.toBeNull();
    fireEvent.click(confirmButton as HTMLElement);

    await waitFor(() => {
      expect(deleteManagedEmailDomainMock).toHaveBeenCalledWith('acme.com');
      expect(updateEmailSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultFromDomain: null,
          ticketingFromEmail: null,
        })
      );
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Domain removal scheduled and ticketing From address cleared');
  });
});

describe('ManagedEmailSettings outbound SMTP test and TLS controls', () => {
  beforeEach(() => {
    getManagedEmailDomainsMock.mockReset();
    requestManagedEmailDomainMock.mockReset();
    refreshManagedEmailDomainMock.mockReset();
    deleteManagedEmailDomainMock.mockReset();
    getEmailSettingsMock.mockReset();
    updateEmailSettingsMock.mockReset();
    getEmailProvidersMock.mockReset();
    testOutboundEmailMock.mockReset();
    getMicrosoftOutboundMailboxesMock.mockReset();
    getMicrosoftOutboundMailboxesMock.mockResolvedValue({ mailboxes: [] });
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    tierContextState.isHosted = true;

    getManagedEmailDomainsMock.mockResolvedValue([]);
    getEmailSettingsMock.mockResolvedValue(smtpSettings);
    updateEmailSettingsMock.mockResolvedValue(smtpSettings);
    getEmailProvidersMock.mockResolvedValue({ providers: [] });
  });

  it('shows one save action and treats edits reverted to their saved values as clean', async () => {
    render(<ManagedEmailSettings />);
    const save = await screen.findByRole('button', { name: 'Save outbound settings' });
    const discard = screen.getByRole('button', { name: 'Discard changes' });
    expect(save).toBeDisabled();
    expect(discard).toBeDisabled();
    expect(document.getElementById('outbound-save-status')).toHaveTextContent('No unsaved changes');
    expect(document.getElementById('save-smtp-settings')).toBeNull();
    expect(document.getElementById('save-sender-identities')).toBeNull();
    fireEvent.change(document.getElementById('smtp-host')!, { target: { value: 'new-relay.lan' } });
    expect(document.getElementById('outbound-save-status')).toHaveTextContent(/^Unsaved changes$/);
    expect(save).toBeEnabled();
    expect(discard).toBeEnabled();
    fireEvent.change(document.getElementById('smtp-host')!, { target: { value: 'relay.lan' } });
    expect(document.getElementById('outbound-save-status')).toHaveTextContent('No unsaved changes');
    expect(save).toBeDisabled();
    expect(discard).toBeDisabled();
    expect(document.getElementById('open-outbound-diagnostics')).toBeEnabled();
    expect(updateEmailSettingsMock).not.toHaveBeenCalled();
  });

  it('locks the SMTP From domain and saves only mailbox-name edits', async () => {
    render(<ManagedEmailSettings />);
    await waitFor(() => expect(document.getElementById('smtp-from')).not.toBeNull());
    expect(document.getElementById('smtp-from')).toHaveValue('noreply');
    expect(document.getElementById('smtp-from-domain')).toHaveTextContent('@acme.com');
    fireEvent.change(document.getElementById('smtp-from')!, {
      target: { value: 'shared@other.com' },
    });
    expect(document.getElementById('smtp-from')).toHaveValue('shared');
    expect(document.getElementById('smtp-from-domain')).toHaveTextContent('@acme.com');
    fireEvent.click(document.getElementById('save-outbound-settings')!);
    await waitFor(() => expect(updateEmailSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultFromDomain: 'acme.com',
        providerConfigs: [expect.objectContaining({ config: expect.objectContaining({ from: 'shared@acme.com' }) })],
      })
    ));
  });

  it('derives the SMTP domain from the ticket identity despite conflicting saved defaults', async () => {
    getEmailSettingsMock.mockResolvedValue({ ...smtpSettings, defaultFromDomain: 'old.example',
      ticketingFromEmail: 'support@customer.example' });
    render(<ManagedEmailSettings />);
    await waitFor(() => expect(document.getElementById('smtp-from')).not.toBeNull());
    expect(document.getElementById('smtp-from-domain')).toHaveTextContent('@customer.example');
    expect(document.getElementById('ticket-from-address')?.getAttribute('data-domain')).toBeNull();
    fireEvent.change(document.getElementById('smtp-from')!, { target: { value: 'noreply' } });
    fireEvent.change(document.getElementById('smtp-host')!, { target: { value: 'relay.customer.example' } });
    fireEvent.click(document.getElementById('save-outbound-settings')!);
    await waitFor(() => expect(updateEmailSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      defaultFromDomain: 'customer.example', ticketingFromEmail: 'support@customer.example',
      providerConfigs: [expect.objectContaining({ config: expect.objectContaining({ from: 'noreply@customer.example' }) })],
    })));
  });

  it('updates the SMTP suffix and saves both identities when the ticket domain changes', async () => {
    render(<ManagedEmailSettings />);
    await waitFor(() => expect(document.getElementById('ticket-from-address')).not.toBeNull());
    fireEvent.change(document.getElementById('ticket-from-address')!, { target: { value: 'tickets@customer.example' } });
    expect(document.getElementById('smtp-from-domain')).toHaveTextContent('@customer.example');
    expect(document.getElementById('smtp-from')).toHaveValue('noreply');
    fireEvent.click(document.getElementById('save-outbound-settings')!);
    await waitFor(() => expect(updateEmailSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      defaultFromDomain: 'customer.example', ticketingFromEmail: 'tickets@customer.example',
      providerConfigs: [expect.objectContaining({ config: expect.objectContaining({ from: 'noreply@customer.example' }) })],
    })));
  });

  it('shows readable missing-identity messages when the loaded translations omit the new keys', async () => {
    const resources = i18n.getResourceBundle('en', 'msp/email-providers');
    const smtpCopy = resources.managed.outbound.smtp;
    const ticketCopy = resources.managed.outbound.senderIdentities.ticket;
    const requiredMessage = smtpCopy.ticketIdentityRequired;
    const ticketHelp = ticketCopy.smtpAddressHelp;
    delete smtpCopy.ticketIdentityRequired;
    delete ticketCopy.smtpAddressHelp;
    try {
      getEmailSettingsMock.mockResolvedValue({ ...smtpSettings, ticketingFromEmail: null });
      render(<ManagedEmailSettings />);
      expect(await screen.findByText('Choose a ticket email identity below to set the sending domain.')).toBeInTheDocument();
      fireEvent.change(document.getElementById('smtp-host')!, { target: { value: 'new-relay.lan' } });
      fireEvent.click(document.getElementById('save-outbound-settings')!);
      expect(screen.getByRole('alert')).toHaveTextContent('Choose a ticket email identity below to set the sending domain.');
      expect(updateEmailSettingsMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId('outbound-diagnostics-dialog')).not.toBeInTheDocument();
    } finally {
      smtpCopy.ticketIdentityRequired = requiredMessage;
      ticketCopy.smtpAddressHelp = ticketHelp;
    }
  });

  it('requires a ticket identity instead of displaying a fallback SMTP domain during setup', async () => {
    getEmailSettingsMock.mockResolvedValue({ ...smtpSettings, ticketingFromEmail: null });
    render(<ManagedEmailSettings />);
    await waitFor(() => expect(document.getElementById('smtp-from')).not.toBeNull());
    expect(document.getElementById('smtp-from-domain')).toBeNull();
    expect(document.getElementById('ticket-from-address')).toBeEnabled();
    expect(document.getElementById('smtp-from')).toBeDisabled();
    expect(document.getElementById('save-outbound-settings')).toBeDisabled();
    expect(screen.getByText('Choose a ticket email identity below to set the sending domain.')).toBeInTheDocument();
    fireEvent.change(document.getElementById('ticket-from-address')!, { target: { value: 'support@customer.example' } });
    expect(document.getElementById('smtp-from-domain')).toHaveTextContent('@customer.example');
    expect(document.getElementById('smtp-from')).toBeEnabled();
  });

  it('uses the ticket domain when switching to SMTP', async () => {
    getEmailSettingsMock.mockResolvedValue({ ...smtpSettings, emailProvider: 'resend',
      defaultFromDomain: 'old.example', ticketingFromEmail: 'support@customer.example' });
    render(<ManagedEmailSettings />);
    await waitFor(() => expect(document.getElementById('outbound-provider-select')).not.toBeNull());
    fireEvent.change(document.getElementById('outbound-provider-select')!, { target: { value: 'smtp' } });
    expect(updateEmailSettingsMock).not.toHaveBeenCalled();
    expect(document.getElementById('smtp-from-domain')).toHaveTextContent('@customer.example');
    fireEvent.click(document.getElementById('save-outbound-settings')!);
    await waitFor(() => expect(updateEmailSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      emailProvider: 'smtp', defaultFromDomain: 'customer.example',
      providerConfigs: [expect.objectContaining({ config: expect.objectContaining({ from: 'noreply@customer.example' }) })],
    })));
  });

  it('opens diagnostics for saved settings without saving or sending an email', async () => {
    render(<ManagedEmailSettings />);
    fireEvent.click(await screen.findByRole('button', { name: /run outbound diagnostics/i }));
    expect(await screen.findByTestId('outbound-diagnostics-dialog')).toBeInTheDocument();
    expect(updateEmailSettingsMock).not.toHaveBeenCalled();
    expect(testOutboundEmailMock).not.toHaveBeenCalled();
  });

  it('requires saving or discarding pending edits before diagnostics can run', async () => {
    render(<ManagedEmailSettings />);
    const diagnostics = await screen.findByRole('button', { name: /run outbound diagnostics/i });
    expect(diagnostics).toBeEnabled();
    fireEvent.change(document.getElementById('smtp-host')!, { target: { value: 'new-relay.lan' } });
    expect(diagnostics).toBeDisabled();
    fireEvent.click(diagnostics);
    expect(updateEmailSettingsMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('outbound-diagnostics-dialog')).not.toBeInTheDocument();
    fireEvent.click(document.getElementById('discard-outbound-changes')!);
    expect(document.getElementById('smtp-host')).toHaveValue('relay.lan');
    expect(diagnostics).toBeEnabled();
    fireEvent.click(diagnostics);
    expect(await screen.findByTestId('outbound-diagnostics-dialog')).toBeInTheDocument();
    expect(updateEmailSettingsMock).not.toHaveBeenCalled();
  });

  it('persists the TLS security toggles with the SMTP config', async () => {
    render(<ManagedEmailSettings />);

    // rejectUnauthorized defaults to on; turning it off must be saved so
    // self-signed LAN relays can be configured.
    const verifyCertToggle = await waitFor(() => {
      const el = document.getElementById('smtp-reject-unauthorized');
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    expect(verifyCertToggle.checked).toBe(true);
    fireEvent.click(verifyCertToggle);

    const requireTlsToggle = document.getElementById('smtp-require-tls') as HTMLInputElement;
    expect(requireTlsToggle.checked).toBe(false);
    fireEvent.click(requireTlsToggle);

    fireEvent.click(screen.getByRole('button', { name: /save outbound settings/i }));

    await waitFor(() => {
      expect(updateEmailSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          emailProvider: 'smtp',
          providerConfigs: [
            expect.objectContaining({
              providerType: 'smtp',
              config: expect.objectContaining({
                rejectUnauthorized: false,
                requireTLS: true,
              }),
            }),
          ],
        })
      );
    });
  });

  it('saves notification branding without changing the ticket identity fields', async () => {
    render(<ManagedEmailSettings />);

    await waitFor(() => expect(document.getElementById('smtp-from-name')).not.toBeNull());
    fireEvent.change(document.getElementById('smtp-from-name')!, {
      target: { value: 'Acme Billing' },
    });
    fireEvent.click(document.getElementById('save-outbound-settings')!);

    await waitFor(() => {
      expect(updateEmailSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
        ticketingFromEmail: 'support@acme.com',
        providerConfigs: [expect.objectContaining({
          providerType: 'smtp',
          config: expect.objectContaining({ fromName: 'Acme Billing' }),
        })],
      }));
    });
  });

  it('saves ticket identity edits without replacing notification branding', async () => {
    getEmailSettingsMock.mockResolvedValue({
      ...smtpSettings,
      providerConfigs: [{
        ...smtpSettings.providerConfigs[0],
        config: { ...smtpSettings.providerConfigs[0].config, fromName: 'Acme Billing' },
      }],
    });

    render(<ManagedEmailSettings />);

    await waitFor(() => expect(document.getElementById('ticket-from-name')).not.toBeNull());
    fireEvent.change(document.getElementById('ticket-from-name')!, {
      target: { value: 'Acme Support' },
    });
    fireEvent.click(document.getElementById('save-outbound-settings')!);

    await waitFor(() => {
      expect(updateEmailSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
        ticketingFromName: 'Acme Support',
        providerConfigs: [expect.objectContaining({
          config: expect.objectContaining({ fromName: 'Acme Billing' }),
        })],
      }));
    });
  });

  it('offers SMTP and Microsoft but not managed email on self-host', async () => {
    tierContextState.isHosted = false;
    getManagedEmailDomainsMock.mockRejectedValue(new Error('managed domains should not load'));
    getEmailSettingsMock.mockResolvedValue(baseSettings);
    getEmailProvidersMock.mockResolvedValue({ providers: [] });

    render(<ManagedEmailSettings />);

    expect(await screen.findByText('SMTP Configuration')).toBeInTheDocument();

    await waitFor(() => {
      expect(getEmailSettingsMock).toHaveBeenCalled();
    });
    expect(getManagedEmailDomainsMock).not.toHaveBeenCalled();

    // Self-host can send via its own SMTP relay or an authorized Microsoft 365
    // mailbox, but never via the hosted (Resend) managed sender.
    const providerSelect = document.getElementById('outbound-provider-select') as HTMLSelectElement | null;
    expect(providerSelect).not.toBeNull();
    const offered = Array.from(providerSelect!.options).map(option => option.value);
    expect(offered).toContain('smtp');
    expect(offered).toContain('microsoft');
    expect(offered).not.toContain('resend');

    expect(
      screen.queryByText(/Managed email domains are not available on your current plan/i)
    ).not.toBeInTheDocument();
  });

  it('stages Microsoft and its connected mailbox until the outbound settings are saved', async () => {
    tierContextState.isHosted = false;
    getEmailSettingsMock.mockResolvedValue(baseSettings);
    getEmailProvidersMock.mockResolvedValue({ providers: [] });
    getMicrosoftOutboundMailboxesMock.mockResolvedValue({
      mailboxes: [{
        providerId: 'ms-provider-1',
        providerName: 'Support Mailbox',
        mailbox: 'support@acme.com',
        senderDisplayName: 'Acme Support',
        status: 'connected',
      }],
    });
    updateEmailSettingsMock.mockResolvedValue({
      ...baseSettings,
      emailProvider: 'microsoft',
      providerConfigs: [],
    });

    render(<ManagedEmailSettings />);

    await waitFor(() => {
      expect(document.getElementById('outbound-provider-select')).not.toBeNull();
    });
    fireEvent.change(document.getElementById('outbound-provider-select')!, {
      target: { value: 'microsoft' },
    });

    expect(updateEmailSettingsMock).not.toHaveBeenCalled();
    expect(document.getElementById('microsoft-outbound-mailbox')).toHaveValue('ms-provider-1');
    expect(document.getElementById('ticket-from-address')).toHaveValue('support@acme.com');
    fireEvent.click(document.getElementById('save-outbound-settings')!);
    await waitFor(() => expect(updateEmailSettingsMock).toHaveBeenCalledTimes(1));


    // The save must name the mailbox; updateEmailSettings rejects a Microsoft
    // selection whose config carries no inboundProviderId.
    const saved = updateEmailSettingsMock.mock.calls.at(-1)![0];
    expect(saved.emailProvider).toBe('microsoft');
    const msConfig = saved.providerConfigs.find((c: any) => c.providerType === 'microsoft');
    expect(msConfig.config.inboundProviderId).toBe('ms-provider-1');
    expect(msConfig.config.from).toBe('support@acme.com');
  });

  it('refuses to switch to Microsoft when no mailbox is authorized', async () => {
    tierContextState.isHosted = false;
    getEmailSettingsMock.mockResolvedValue(baseSettings);
    getEmailProvidersMock.mockResolvedValue({ providers: [] });
    getMicrosoftOutboundMailboxesMock.mockResolvedValue({ mailboxes: [] });

    render(<ManagedEmailSettings />);

    await waitFor(() => {
      expect(document.getElementById('outbound-provider-select')).not.toBeNull();
    });
    fireEvent.change(document.getElementById('outbound-provider-select')!, {
      target: { value: 'microsoft' },
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled();
    });
    expect(updateEmailSettingsMock).not.toHaveBeenCalled();
  });

  it('saves provider, connection, and both sender edits in one request and locks editing during the save', async () => {
    let finish!: (value: typeof smtpSettings) => void;
    updateEmailSettingsMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<ManagedEmailSettings />);
    await screen.findByLabelText(/smtp host/i);
    fireEvent.change(document.getElementById('smtp-host')!, { target: { value: 'new-relay.lan' } });
    fireEvent.change(document.getElementById('smtp-password')!, { target: { value: 'new-password' } });
    fireEvent.change(document.getElementById('smtp-from-name')!, { target: { value: 'Acme Billing' } });
    fireEvent.change(document.getElementById('ticket-from-address')!, { target: { value: 'tickets@customer.example' } });
    fireEvent.change(document.getElementById('ticket-from-name')!, { target: { value: 'Acme Support' } });
    expect(updateEmailSettingsMock).not.toHaveBeenCalled();
    const save = document.getElementById('save-outbound-settings')!;
    fireEvent.click(save);
    expect(updateEmailSettingsMock).toHaveBeenCalledTimes(1);
    expect(updateEmailSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      emailProvider: 'smtp', defaultFromDomain: 'customer.example',
      ticketingFromEmail: 'tickets@customer.example', ticketingFromName: 'Acme Support',
      providerConfigs: [expect.objectContaining({ isEnabled: true, config: expect.objectContaining({
        host: 'new-relay.lan', password: 'new-password', from: 'noreply@customer.example', fromName: 'Acme Billing',
      }) })],
    }));
    for (const id of ['save-outbound-settings', 'discard-outbound-changes', 'outbound-provider-select',
      'smtp-host', 'smtp-password', 'smtp-from', 'smtp-from-name', 'smtp-require-tls',
      'ticket-from-address', 'ticket-from-name', 'open-outbound-diagnostics']) {
      expect(document.getElementById(id), id).toBeDisabled();
    }
    fireEvent.click(save);
    expect(updateEmailSettingsMock).toHaveBeenCalledTimes(1);
    const submitted = updateEmailSettingsMock.mock.calls[0][0];
    await act(async () => finish({ ...smtpSettings, ...submitted }));
    expect(document.getElementById('open-outbound-diagnostics')).toBeEnabled();
    expect(save).toBeDisabled();
    fireEvent.change(document.getElementById('smtp-host')!, { target: { value: 'discard-this.lan' } });
    fireEvent.change(document.getElementById('ticket-from-name')!, { target: { value: 'Discard this name' } });
    fireEvent.click(document.getElementById('discard-outbound-changes')!);
    expect(document.getElementById('smtp-host')).toHaveValue('new-relay.lan');
    expect(document.getElementById('ticket-from-name')).toHaveValue('Acme Support');
    expect(document.getElementById('smtp-from-name')).toHaveValue('Acme Billing');
    expect(document.getElementById('ticket-from-address')).toHaveValue('tickets@customer.example');
    expect(updateEmailSettingsMock).toHaveBeenCalledTimes(1);
  });

  it('stages a changed Microsoft mailbox and its ticket identity without saving other pending edits', async () => {
    const mailboxConfig = (id: string, mailbox: string) => ({ providerId: id, providerType: 'microsoft', isEnabled: true,
      config: { inboundProviderId: id, mailbox, from: mailbox } });
    const initial = { ...baseSettings, emailProvider: 'microsoft', ticketingFromEmail: 'one@acme.com',
      ticketingFromName: 'Support', providerConfigs: [mailboxConfig('ms-one', 'one@acme.com')] };
    getEmailSettingsMock.mockResolvedValue(initial);
    getMicrosoftOutboundMailboxesMock.mockResolvedValue({ mailboxes: [
      { providerId: 'ms-one', providerName: 'One', mailbox: 'one@acme.com', status: 'connected' },
      { providerId: 'ms-two', providerName: 'Two', mailbox: 'two@acme.com', status: 'connected' },
    ] });
    render(<ManagedEmailSettings />);
    await waitFor(() => expect(document.getElementById('microsoft-outbound-mailbox')).not.toBeNull());
    fireEvent.change(document.getElementById('ticket-from-name')!, { target: { value: 'New Support' } });
    fireEvent.change(document.getElementById('microsoft-outbound-mailbox')!, { target: { value: 'ms-two' } });
    expect(updateEmailSettingsMock).not.toHaveBeenCalled();
    expect(document.getElementById('ticket-from-address')).toHaveValue('two@acme.com');
    expect(document.getElementById('ticket-from-name')).toHaveValue('New Support');
    fireEvent.click(document.getElementById('discard-outbound-changes')!);
    expect(document.getElementById('microsoft-outbound-mailbox')).toHaveValue('ms-one');
    expect(document.getElementById('ticket-from-address')).toHaveValue('one@acme.com');
    expect(document.getElementById('ticket-from-name')).toHaveValue('Support');
    expect(updateEmailSettingsMock).not.toHaveBeenCalled();
    fireEvent.change(document.getElementById('microsoft-outbound-mailbox')!, { target: { value: 'ms-two' } });
    fireEvent.click(document.getElementById('save-outbound-settings')!);
    await waitFor(() => expect(updateEmailSettingsMock).toHaveBeenCalledTimes(1));
    expect(updateEmailSettingsMock.mock.calls[0][0]).toMatchObject({
      emailProvider: 'microsoft', ticketingFromEmail: 'two@acme.com',
      providerConfigs: [mailboxConfig('ms-two', 'two@acme.com')],
    });
  });

  it('retains the chosen provider and pending edits after a rejected save, then discards to the saved settings', async () => {
    getMicrosoftOutboundMailboxesMock.mockResolvedValue({ mailboxes: [{
      providerId: 'ms-provider-1', providerName: 'Support', mailbox: 'shared@acme.com', status: 'connected',
    }] });
    updateEmailSettingsMock.mockRejectedValueOnce(new Error('Connection lost'));
    render(<ManagedEmailSettings />);
    await screen.findByLabelText(/smtp host/i);
    fireEvent.change(document.getElementById('smtp-host')!, { target: { value: 'pending-relay.lan' } });
    fireEvent.change(document.getElementById('outbound-provider-select')!, { target: { value: 'microsoft' } });
    fireEvent.change(document.getElementById('ticket-from-name')!, { target: { value: 'Pending Support' } });
    expect(updateEmailSettingsMock).not.toHaveBeenCalled();
    fireEvent.click(document.getElementById('save-outbound-settings')!);
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(document.getElementById('outbound-provider-select')).toHaveValue('microsoft');
    expect(document.getElementById('ticket-from-name')).toHaveValue('Pending Support');
    expect(document.getElementById('save-outbound-settings')).toBeEnabled();
    expect(document.getElementById('open-outbound-diagnostics')).toBeDisabled();
    fireEvent.click(document.getElementById('discard-outbound-changes')!);
    expect(document.getElementById('outbound-provider-select')).toHaveValue('smtp');
    expect(document.getElementById('smtp-host')).toHaveValue('relay.lan');
    expect(document.getElementById('ticket-from-address')).toHaveValue('support@acme.com');
    expect(document.getElementById('ticket-from-name')).toHaveValue('');
    expect(document.getElementById('open-outbound-diagnostics')).toBeEnabled();
    expect(updateEmailSettingsMock).toHaveBeenCalledTimes(1);
  });

  it('accepts SMTP host input on self-host when provider configs are empty', async () => {
    tierContextState.isHosted = false;
    getEmailSettingsMock.mockResolvedValue(baseSettings);

    render(<ManagedEmailSettings />);

    const hostInput = await screen.findByLabelText(/smtp host/i);
    fireEvent.change(hostInput, { target: { value: 'relay.appliance.lan' } });

    expect(hostInput).toHaveValue('relay.appliance.lan');
  });

  it('creates and enables the SMTP config when saving from an empty provider list', async () => {
    tierContextState.isHosted = false;
    getEmailSettingsMock.mockResolvedValue(baseSettings);
    updateEmailSettingsMock.mockResolvedValue(smtpSettings);

    render(<ManagedEmailSettings />);

    fireEvent.change(await screen.findByLabelText(/smtp host/i), {
      target: { value: 'relay.appliance.lan' },
    });
    fireEvent.change(document.getElementById('smtp-from') as HTMLInputElement, {
      target: { value: 'support' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save outbound settings/i }));

    await waitFor(() => {
      expect(updateEmailSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          emailProvider: 'smtp',
          providerConfigs: [
            expect.objectContaining({
              providerType: 'smtp',
              isEnabled: true,
              config: expect.objectContaining({
                host: 'relay.appliance.lan',
                from: 'support@acme.com',
              }),
            }),
          ],
        })
      );
    });
  });
});
