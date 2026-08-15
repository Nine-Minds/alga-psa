import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const systemSendEmail = vi.fn();

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    system: vi.fn(),
  },
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => ({})),
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../../../../../packages/email/src/emailLocaleResolver', () => ({
  getUserInfoForEmail: vi.fn(async () => ({
    email: 'user@example.com',
    userId: 'user-1',
    userType: 'internal',
  })),
  resolveEmailLocale: vi.fn(async () => 'en'),
}));

vi.mock('../../../../../packages/email/src/index', () => ({
  getSystemEmailService: vi.fn(async () => ({
    sendEmail: systemSendEmail,
  })),
  TenantEmailService: {
    getInstance: vi.fn(),
  },
}));

import {
  getSystemEmailService,
  TenantEmailService,
} from '../../../../../packages/email/src/index';
import { sendPasswordResetEmail } from '../../../../../packages/email/src/sendPasswordResetEmail';

const mockedGetSystemEmailService = vi.mocked(getSystemEmailService);
const mockedGetInstance = vi.mocked(TenantEmailService.getInstance);

const baseParams = {
  email: 'user@example.com',
  userName: 'Test User',
  resetLink: 'http://localhost/auth/password-reset/set-new-password?token=abc',
  expirationTime: '1 hour',
  tenant: 'tenant-1',
  supportEmail: 'support@example.com',
  clientName: 'AlgaPSA',
} as Parameters<typeof sendPasswordResetEmail>[0];

function sendResult(overrides: Record<string, unknown>): any {
  return {
    success: false,
    error: 'unknown_error',
    sentAt: new Date('2026-08-14T00:00:00.000Z'),
    ...overrides,
  };
}

describe('sendPasswordResetEmail provider fallback boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    systemSendEmail.mockReset();
    mockedGetSystemEmailService.mockResolvedValue({ sendEmail: systemSendEmail } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not call the explicit system fallback when the tenant attempt succeeds', async () => {
    const tenantSendEmail = vi.fn(async () =>
      sendResult({ success: true, providerId: 'tenant-smtp', providerType: 'smtp' })
    );
    mockedGetInstance.mockReturnValue({ sendEmail: tenantSendEmail } as any);

    const result = await sendPasswordResetEmail(baseParams);

    expect(result).toBe(true);
    expect(tenantSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedGetSystemEmailService).not.toHaveBeenCalled();
    expect(systemSendEmail).not.toHaveBeenCalled();
  });

  it('calls a distinct system fallback once and accepts its success after a tenant failure', async () => {
    const tenantSendEmail = vi.fn(async () =>
      sendResult({ providerId: 'tenant-smtp', providerType: 'smtp', error: 'tenant smtp down' })
    );
    mockedGetInstance.mockReturnValue({ sendEmail: tenantSendEmail } as any);
    systemSendEmail.mockResolvedValue(
      sendResult({ success: true, providerId: 'system-email-provider', providerType: 'smtp' })
    );

    const result = await sendPasswordResetEmail(baseParams);

    expect(result).toBe(true);
    expect(tenantSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedGetSystemEmailService).toHaveBeenCalledTimes(1);
    expect(systemSendEmail).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failure already returned by the system-email-provider', async () => {
    const tenantSendEmail = vi.fn(async () =>
      sendResult({ providerId: 'system-email-provider', providerType: 'smtp', error: 'system provider rejected' })
    );
    mockedGetInstance.mockReturnValue({ sendEmail: tenantSendEmail } as any);

    await expect(sendPasswordResetEmail(baseParams)).rejects.toThrow('system provider rejected');

    expect(tenantSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedGetSystemEmailService).not.toHaveBeenCalled();
    expect(systemSendEmail).not.toHaveBeenCalled();
  });

  it('retains both causes and never masks the tenant SMTP error when both paths fail', async () => {
    const tenantSendEmail = vi.fn(async () =>
      sendResult({
        providerId: 'tenant-smtp',
        providerType: 'smtp',
        error: 'SMTP auth failed: bad credentials',
      })
    );
    mockedGetInstance.mockReturnValue({ sendEmail: tenantSendEmail } as any);
    systemSendEmail.mockResolvedValue(
      sendResult({ error: 'Email service is disabled or not configured' })
    );

    const error = await sendPasswordResetEmail(baseParams).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('SMTP auth failed: bad credentials');
    expect(error.message).toContain('Email service is disabled or not configured');
    expect(mockedGetSystemEmailService).toHaveBeenCalledTimes(1);
  });
});
