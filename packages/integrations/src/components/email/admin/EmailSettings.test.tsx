// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailSettings } from './EmailSettings';

const {
  getEmailDomainsMock,
  getEmailProvidersMock,
  getEmailSettingsMock,
  getMicrosoftOutboundMailboxesMock,
  updateEmailSettingsMock,
} = vi.hoisted(() => ({
  getEmailDomainsMock: vi.fn(),
  getEmailProvidersMock: vi.fn(),
  getEmailSettingsMock: vi.fn(),
  getMicrosoftOutboundMailboxesMock: vi.fn(),
  updateEmailSettingsMock: vi.fn(),
}));

vi.mock('../../../actions/email-actions/emailSettingsActions', () => ({
  getEmailSettings: getEmailSettingsMock,
  getMicrosoftOutboundMailboxes: getMicrosoftOutboundMailboxesMock,
  updateEmailSettings: updateEmailSettingsMock,
  testOutboundEmail: vi.fn(),
}));

vi.mock('../../../actions/email-actions/emailProviderActions', () => ({
  getEmailProviders: getEmailProvidersMock,
}));

vi.mock('../../../actions/email-actions/emailDomainActions', () => ({
  getEmailDomains: getEmailDomainsMock,
  addEmailDomain: vi.fn(),
  verifyEmailDomain: vi.fn(),
}));

vi.mock('../EmailProviderConfiguration', () => ({
  EmailProviderConfiguration: () => <div />,
}));

vi.mock('@alga-psa/ui/components/providers/TenantProvider', () => ({
  useTenant: () => 'tenant-1',
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; company?: string }) => {
      if (key === 'email.senderIdentities.notification.nameHelp') {
        return `Leave blank to use ${options?.company} automatically.`;
      }
      return options?.defaultValue || key;
    },
  }),
}));

vi.mock('@alga-psa/ui/components/Tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange }: any) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

const settings = {
  tenantId: 'tenant-1',
  defaultFromDomain: 'example.test',
  ticketingFromEmail: 'support@example.test',
  ticketingFromName: 'Example Support',
  customDomains: [],
  emailProvider: 'smtp' as const,
  providerConfigs: [{
    providerId: 'smtp-provider',
    providerType: 'smtp' as const,
    isEnabled: true,
    config: {
      host: 'smtp.example.test',
      port: 587,
      from: 'notifications@example.test',
      fromName: '',
    },
  }],
  trackingEnabled: false,
  createdAt: new Date('2026-08-04T00:00:00.000Z'),
  updatedAt: new Date('2026-08-04T00:00:00.000Z'),
  tenantCompanyName: 'Example MSP',
  effectiveNotificationFrom: {
    email: 'notifications@example.test',
    name: 'Example MSP',
  },
};

describe('EmailSettings sender identities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEmailSettingsMock.mockResolvedValue(settings);
    updateEmailSettingsMock.mockImplementation(async (value) => value);
    getEmailProvidersMock.mockResolvedValue({
      providers: [{ mailbox: 'support@example.test' }],
    });
    getMicrosoftOutboundMailboxesMock.mockResolvedValue({ mailboxes: [] });
    getEmailDomainsMock.mockResolvedValue([]);
  });

  it('renders both identities and saves each field to its existing storage group', async () => {
    render(<EmailSettings />);

    expect(await screen.findByText('email.senderIdentities.ticket.title')).toBeInTheDocument();
    expect(screen.getByText('email.senderIdentities.notification.title')).toBeInTheDocument();
    expect(screen.getByText('Leave blank to use Example MSP automatically.')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Example Support'), {
      target: { value: 'Example Helpdesk' },
    });
    fireEvent.change(
      screen.getByPlaceholderText('email.senderIdentities.notification.namePlaceholder'),
      { target: { value: 'Example Billing' } }
    );
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(updateEmailSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
        ticketingFromName: 'Example Helpdesk',
        providerConfigs: [expect.objectContaining({
          providerType: 'smtp',
          config: expect.objectContaining({
            from: 'notifications@example.test',
            fromName: 'Example Billing',
          }),
        })],
      }));
    });
  });
});
