import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getConnectionMock,
  resolveEmailLocaleMock,
  systemSendMock,
  tenantSendMock,
} = vi.hoisted(() => ({
  getConnectionMock: vi.fn(),
  resolveEmailLocaleMock: vi.fn(),
  systemSendMock: vi.fn(),
  tenantSendMock: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: getConnectionMock,
  runWithTenant: (_tenant: string, callback: () => Promise<unknown>) => callback(),
}));

vi.mock('../index', () => ({
  getSystemEmailService: vi.fn(async () => ({ sendEmail: systemSendMock })),
  TenantEmailService: {
    getInstance: vi.fn(() => ({ sendEmail: tenantSendMock })),
  },
}));

vi.mock('../emailLocaleResolver', () => ({
  getUserInfoForEmail: vi.fn(async () => null),
  resolveEmailLocale: resolveEmailLocaleMock,
}));

vi.mock('../templateProcessors', () => ({
  DatabaseTemplateProcessor: class {},
}));

import { sendPortalInvitationEmail } from '../sendPortalInvitationEmail';

const params = {
  email: 'contact@example.test',
  contactName: 'Casey Client',
  clientName: 'Example Client',
  tenantName: 'Example MSP',
  portalLink: 'https://portal.example.test/setup',
  expirationTime: '24 hours',
  tenant: 'tenant-1',
  supportEmail: 'support@example.test',
  fromName: 'Example MSP Portal',
};

describe('sendPortalInvitationEmail sender identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue({});
    resolveEmailLocaleMock.mockResolvedValue('en');
    tenantSendMock.mockResolvedValue({ success: true });
    systemSendMock.mockResolvedValue({ success: true });
  });

  it('forwards the explicit portal display name to the tenant provider', async () => {
    await sendPortalInvitationEmail(params);

    expect(tenantSendMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      fromName: 'Example MSP Portal',
      replyTo: 'support@example.test',
    }));
    expect(systemSendMock).not.toHaveBeenCalled();
  });

  it('forwards the same display name to the system fallback without a tenant From address', async () => {
    tenantSendMock.mockResolvedValue({ success: false, error: 'provider unavailable' });

    await sendPortalInvitationEmail(params);

    expect(systemSendMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      fromName: 'Example MSP Portal',
      replyTo: 'support@example.test',
    }));
    expect(systemSendMock.mock.calls[0]?.[0]).not.toHaveProperty('from');
  });
});
