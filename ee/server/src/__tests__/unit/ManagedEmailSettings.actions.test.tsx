// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  EmailSenderCardsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  EmailSenderAddressesCard: () => <div data-testid="email-sender-addresses-card" />,
  EmailSenderRoutingCard: () => <div data-testid="email-sender-routing-card" />,
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
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    id?: string;
  }) => (
    <input
      id={id}
      type="checkbox"
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
  });

  it('does not expose a thrown English domain-loading error', async () => {
    getManagedEmailDomainsMock.mockRejectedValue(new Error('Secret backend trace'));

    render(<ManagedEmailSettings />);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Failed to load managed domains');
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith('Secret backend trace');
  });

  it('renders sender identity management in the sender cards', async () => {
    render(<ManagedEmailSettings />);

    expect(await screen.findByTestId('email-sender-addresses-card')).toBeInTheDocument();
    expect(screen.getByTestId('email-sender-routing-card')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear ticket identity/i })).not.toBeInTheDocument();
  });

  it('removing the active managed domain clears only the outbound domain setting', async () => {
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
        }),
      );
    });
    expect(updateEmailSettingsMock.mock.calls[0][0]).not.toHaveProperty('ticketingFromEmail');
    expect(updateEmailSettingsMock.mock.calls[0][0]).not.toHaveProperty('ticketingFromName');
    expect(toastSuccessMock).toHaveBeenCalledWith('Domain removal scheduled');
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
    testOutboundEmailMock.mockReset();
    getMicrosoftOutboundMailboxesMock.mockReset();
    getMicrosoftOutboundMailboxesMock.mockResolvedValue({ mailboxes: [] });
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    tierContextState.isHosted = true;

    getManagedEmailDomainsMock.mockResolvedValue([]);
    getEmailSettingsMock.mockResolvedValue(smtpSettings);
    updateEmailSettingsMock.mockResolvedValue(smtpSettings);
  });

  it('persists current edits and reports success from the connection test', async () => {
    testOutboundEmailMock.mockResolvedValue({ success: true, message: 'SMTP connection verified.' });

    render(<ManagedEmailSettings />);

    const testButton = await screen.findByRole('button', { name: /test connection/i });
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(updateEmailSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ emailProvider: 'smtp' })
      );
      expect(testOutboundEmailMock).toHaveBeenCalledWith(undefined);
    });
    expect(await screen.findByText('SMTP connection verified.')).toBeInTheDocument();
  });

  it('surfaces the real provider error when the connection test fails', async () => {
    testOutboundEmailMock.mockResolvedValue({
      success: false,
      error: 'self-signed certificate in certificate chain',
    });

    render(<ManagedEmailSettings />);

    const testButton = await screen.findByRole('button', { name: /test connection/i });
    fireEvent.click(testButton);

    expect(
      await screen.findByText('self-signed certificate in certificate chain')
    ).toBeInTheDocument();
  });

  it('sends the test message to the entered recipient', async () => {
    testOutboundEmailMock.mockResolvedValue({ success: true, message: 'Test email sent.' });

    render(<ManagedEmailSettings />);

    const recipientInput = await screen.findByLabelText(/send test to/i);
    fireEvent.change(recipientInput, { target: { value: 'admin@acme.com' } });
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() => {
      expect(testOutboundEmailMock).toHaveBeenCalledWith('admin@acme.com');
    });
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

    fireEvent.click(screen.getByRole('button', { name: /save smtp settings/i }));

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

  it('keeps sender address and routing controls in the sender cards alongside SMTP settings', async () => {
    render(<ManagedEmailSettings />);

    expect(await screen.findByTestId('email-sender-addresses-card')).toBeInTheDocument();
    expect(screen.getByTestId('email-sender-routing-card')).toBeInTheDocument();
    expect(screen.queryByLabelText(/notification from/i)).not.toBeInTheDocument();
  });

  it('offers SMTP and Microsoft but not managed email on self-host', async () => {
    tierContextState.isHosted = false;
    getManagedEmailDomainsMock.mockRejectedValue(new Error('managed domains should not load'));
    getEmailSettingsMock.mockResolvedValue(baseSettings);

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

  it('switching to Microsoft saves the connected mailbox as the outbound sender', async () => {
    tierContextState.isHosted = false;
    getEmailSettingsMock.mockResolvedValue(baseSettings);
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

    await waitFor(() => {
      expect(updateEmailSettingsMock).toHaveBeenCalled();
    });

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

  it('waits for a provider switch to finish before allowing another provider change', async () => {
    tierContextState.isHosted = false;
    getEmailSettingsMock.mockResolvedValue(smtpSettings);
    getMicrosoftOutboundMailboxesMock.mockResolvedValue({ mailboxes: [{
      providerId: 'ms-provider-1', providerName: 'Support', mailbox: 'support@acme.com', status: 'connected',
    }] });
    const saved = { ...smtpSettings, emailProvider: 'microsoft',
      providerConfigs: [{ providerId: 'ms-provider-1', providerType: 'microsoft', isEnabled: true,
        config: { inboundProviderId: 'ms-provider-1', mailbox: 'support@acme.com', from: 'support@acme.com' } }] };
    let finish!: (value: typeof saved) => void;
    updateEmailSettingsMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<ManagedEmailSettings />);
    const select = document.getElementById('outbound-provider-select')!;
    await waitFor(() => expect(select).not.toBeDisabled());
    fireEvent.change(select, { target: { value: 'microsoft' } });
    expect(select).toBeDisabled();
    expect(document.getElementById('microsoft-outbound-mailbox')).toBeDisabled();
    expect(updateEmailSettingsMock).toHaveBeenCalledTimes(1);
    finish(saved);
    await waitFor(() => expect(select).not.toBeDisabled());
    expect(select).toHaveValue('microsoft');
    expect(updateEmailSettingsMock.mock.calls[0][0]).toMatchObject({
      emailProvider: 'microsoft',
      providerConfigs: expect.arrayContaining([
        expect.objectContaining({
          providerType: 'microsoft',
          config: expect.objectContaining({ inboundProviderId: 'ms-provider-1' }),
        }),
      ]),
    });
  });

  it('waits for a Microsoft mailbox change before allowing another provider change', async () => {
    const mailboxConfig = (id: string, mailbox: string) => ({ providerId: id, providerType: 'microsoft', isEnabled: true,
      config: { inboundProviderId: id, mailbox, from: mailbox } });
    const initial = { ...baseSettings, emailProvider: 'microsoft',
      providerConfigs: [mailboxConfig('ms-one', 'one@acme.com')] };
    const saved = { ...initial, providerConfigs: [mailboxConfig('ms-two', 'two@acme.com')] };
    getEmailSettingsMock.mockResolvedValue(initial);
    getMicrosoftOutboundMailboxesMock.mockResolvedValue({ mailboxes: [
      { providerId: 'ms-one', providerName: 'One', mailbox: 'one@acme.com', status: 'connected' },
      { providerId: 'ms-two', providerName: 'Two', mailbox: 'two@acme.com', status: 'connected' },
    ] });
    let finish!: (value: typeof saved) => void;
    updateEmailSettingsMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<ManagedEmailSettings />);
    await waitFor(() => expect(document.getElementById('microsoft-outbound-mailbox')).not.toBeDisabled());
    fireEvent.change(document.getElementById('microsoft-outbound-mailbox')!, { target: { value: 'ms-two' } });
    const providerSelect = document.getElementById('outbound-provider-select')!;
    expect(providerSelect).toBeDisabled();
    expect(updateEmailSettingsMock).toHaveBeenCalledTimes(1);
    finish(saved);
    await waitFor(() => expect(providerSelect).not.toBeDisabled());
    expect(document.getElementById('microsoft-outbound-mailbox')).toHaveValue('ms-two');
    expect(updateEmailSettingsMock).toHaveBeenCalledTimes(1);
    expect(updateEmailSettingsMock.mock.calls[0][0]).toMatchObject({
      emailProvider: 'microsoft',
      providerConfigs: saved.providerConfigs,
    });
  });

  it('unlocks the previous provider after a rejected provider switch', async () => {
    tierContextState.isHosted = false;
    getMicrosoftOutboundMailboxesMock.mockResolvedValue({ mailboxes: [{
      providerId: 'ms-provider-1', providerName: 'Support', mailbox: 'support@acme.com', status: 'connected',
    }] });
    let reject!: (error: Error) => void;
    updateEmailSettingsMock.mockImplementationOnce(() => new Promise((_resolve, rejectSave) => { reject = rejectSave; }));
    render(<ManagedEmailSettings />);
    const select = document.getElementById('outbound-provider-select')!;
    await waitFor(() => expect(select).not.toBeDisabled());
    fireEvent.change(select, { target: { value: 'microsoft' } });
    expect(select).toBeDisabled();
    reject(new Error('Connection lost'));
    await waitFor(() => expect(select).not.toBeDisabled());
    expect(select).toHaveValue('smtp');
    expect(document.getElementById('save-smtp-settings')).not.toBeDisabled();
    expect(toastErrorMock).toHaveBeenCalled();
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
      target: { value: 'support@acme.test' },
    });
    expect(await screen.findByTestId('email-sender-addresses-card')).toBeInTheDocument();
    expect(screen.getByTestId('email-sender-routing-card')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save smtp settings/i }));

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
              }),
            }),
          ],
        })
      );
    });
  });
});
