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
  getEmailProvidersMock,
  testOutboundEmailMock,
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
  ticketingFromEmail: 'support@acme.com',
  customDomains: [],
  emailProvider: 'resend' as const,
  providerConfigs: [],
  trackingEnabled: false,
  createdAt: new Date('2026-03-01T00:00:00.000Z'),
  updatedAt: new Date('2026-03-01T00:00:00.000Z'),
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

  it('clears the saved ticketing from address via the explicit clear action', async () => {
    updateEmailSettingsMock.mockResolvedValue({
      ...baseSettings,
      ticketingFromEmail: null,
    });

    render(<ManagedEmailSettings />);

    const clearButton = await screen.findByRole('button', { name: /clear from address/i });
    fireEvent.click(clearButton);
    const confirmButton = document.getElementById('managed-email-clear-ticketing-from-confirm');
    expect(confirmButton).not.toBeNull();
    fireEvent.click(confirmButton as HTMLElement);

    await waitFor(() => {
      expect(updateEmailSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketingFromEmail: null,
        })
      );
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Ticketing from address cleared');
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
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    tierContextState.isHosted = true;

    getManagedEmailDomainsMock.mockResolvedValue([]);
    getEmailSettingsMock.mockResolvedValue(smtpSettings);
    updateEmailSettingsMock.mockResolvedValue(smtpSettings);
    getEmailProvidersMock.mockResolvedValue({ providers: [] });
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

  it('shows only SMTP on self-host without loading managed domains', async () => {
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
    expect(document.getElementById('outbound-provider-select')).toBeNull();
    expect(
      screen.queryByText(/Managed email domains are not available on your current plan/i)
    ).not.toBeInTheDocument();
  });
});
