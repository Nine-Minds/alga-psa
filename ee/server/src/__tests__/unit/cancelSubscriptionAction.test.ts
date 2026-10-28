import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkAccountManagementPermission: vi.fn(),
  getConnection: vi.fn(),
  getSession: vi.fn(),
  getStripeService: vi.fn(),
  sendCancellationRequestEmail: vi.fn(),
  systemSendEmail: vi.fn(),
  useRealHelper: { current: false },
  tenantDb: vi.fn(),
  tenantSelect: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
  tenantRow: { current: undefined as undefined | Record<string, unknown> },
}));

vi.mock('../../lib/license/get-license-usage', () => ({ getLicenseUsage: vi.fn() }));
vi.mock('@alga-psa/auth', () => ({ getSession: mocks.getSession }));
vi.mock('@alga-psa/auth/actions', () => ({
  checkAccountManagementPermission: mocks.checkAccountManagementPermission,
}));
vi.mock('../../lib/stripe/StripeService', () => ({
  AppleIapBillingError: class AppleIapBillingError extends Error {},
  getStripeService: mocks.getStripeService,
}));
vi.mock('@/lib/db/db', () => ({ getConnection: mocks.getConnection }));
vi.mock('@alga-psa/core/logger', () => ({
  default: { error: mocks.loggerError, info: mocks.loggerInfo, warn: mocks.loggerWarn },
}));
// Default to the stubbed helper; tests that exercise the real helper flip useRealHelper.
vi.mock('@alga-psa/email/sendCancellationRequestEmail', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/email/sendCancellationRequestEmail')>(
    '@alga-psa/email/sendCancellationRequestEmail'
  );
  return {
    sendCancellationRequestEmail: (...args: Parameters<typeof actual.sendCancellationRequestEmail>) =>
      mocks.useRealHelper.current
        ? actual.sendCancellationRequestEmail(...args)
        : mocks.sendCancellationRequestEmail(...args),
  };
});
vi.mock('@alga-psa/email/system/SystemEmailService', () => ({
  getSystemEmailService: async () => ({ sendEmail: mocks.systemSendEmail }),
}));
vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({
  resolveEmailLocale: vi.fn(async () => 'es'),
}));
vi.mock('@alga-psa/email', () => ({ sendCancellationFeedbackEmail: vi.fn() }));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (...args: unknown[]) => {
    mocks.tenantDb(...args);
    return {
      table: (tableName: string) => {
        if (tableName === 'stripe_subscriptions') {
          return {
            whereIn: () => ({
              first: async () => ({
                stripe_subscription_id: 'local-sub-1',
                stripe_subscription_external_id: 'sub_ext_1',
                metadata: null,
              }),
            }),
            where: () => ({ update: async () => 1 }),
          };
        }

        if (tableName === 'tenants') {
          return {
            select: (...cols: unknown[]) => {
              mocks.tenantSelect(...cols);
              return { first: async () => mocks.tenantRow.current };
            },
          };
        }

        throw new Error(`Unexpected table: ${tableName}`);
      },
    };
  },
}));

import { cancelSubscriptionAction } from '../../lib/actions/license-actions';

const CANCEL_AT = 1788220800; // seconds

describe('cancelSubscriptionAction cancellation request email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useRealHelper.current = false;
    mocks.tenantRow.current = { email: 'owner@example.test', client_name: 'Acme Corp' };
    mocks.getSession.mockResolvedValue({ user: { tenant: 'tenant-1', email: 'session@example.test' } });
    mocks.checkAccountManagementPermission.mockResolvedValue(true);
    mocks.getConnection.mockResolvedValue({ fn: { now: () => 'now' } });
    mocks.sendCancellationRequestEmail.mockResolvedValue(undefined);
    mocks.getStripeService.mockReturnValue({
      isConfigured: async () => true,
      getStripeClient: async () => ({
        subscriptions: {
          retrieve: async () => ({ schedule: null }),
          update: async () => ({ cancel_at: CANCEL_AT }),
        },
        subscriptionSchedules: { release: vi.fn() },
      }),
    });
  });

  it('sends the email to the cancelling tenant using client_name', async () => {
    const result = await cancelSubscriptionAction();

    expect(result.success).toBe(true);
    expect(mocks.sendCancellationRequestEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendCancellationRequestEmail).toHaveBeenCalledWith({
      tenantName: 'Acme Corp',
      recipientName: 'Acme Corp',
      recipientEmail: 'owner@example.test',
      cancelAtDate: new Date(CANCEL_AT * 1000).toISOString(),
      locale: 'es',
    });
  });

  it('selects only existing tenants columns (no company_name)', async () => {
    await cancelSubscriptionAction();

    expect(mocks.tenantSelect).toHaveBeenCalledTimes(1);
    expect(mocks.tenantSelect).toHaveBeenCalledWith('email', 'client_name');
    expect(mocks.tenantSelect.mock.calls[0]).not.toContain('company_name');
  });

  it('runs the lookup through tenantDb scoped to the session tenant', async () => {
    await cancelSubscriptionAction();

    expect(mocks.tenantDb).toHaveBeenCalledWith(expect.anything(), 'tenant-1');
  });

  it('falls back to a generic name when client_name is empty', async () => {
    mocks.tenantRow.current = { email: 'owner@example.test', client_name: null };
    await cancelSubscriptionAction();

    expect(mocks.sendCancellationRequestEmail).toHaveBeenCalledWith(
      expect.objectContaining({ tenantName: 'your organization', recipientName: 'your organization' })
    );
  });

  it('warns and skips the email when the tenant has no email', async () => {
    mocks.tenantRow.current = { email: null, client_name: 'Acme Corp' };
    const result = await cancelSubscriptionAction();

    expect(result.success).toBe(true);
    expect(mocks.sendCancellationRequestEmail).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalledWith(expect.stringContaining('[tenant=tenant-1]'));
  });

  it('still succeeds and logs an error with the tenant id when the email send rejects', async () => {
    const failure = new Error('smtp down');
    mocks.sendCancellationRequestEmail.mockRejectedValue(failure);

    const result = await cancelSubscriptionAction();

    expect(result.success).toBe(true);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.stringContaining('[cancelSubscriptionAction][tenant=tenant-1]'),
      failure
    );
  });

  it('does not log success and logs an error when the email service resolves { success: false }', async () => {
    mocks.useRealHelper.current = true;
    mocks.systemSendEmail.mockResolvedValue({ success: false, error: 'SMTP connection refused' });

    const result = await cancelSubscriptionAction();

    expect(result.success).toBe(true);
    expect(mocks.systemSendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.loggerInfo).not.toHaveBeenCalledWith(
      expect.stringContaining('Cancellation request email sent')
    );
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.stringContaining('[cancelSubscriptionAction][tenant=tenant-1]'),
      expect.objectContaining({ message: expect.stringContaining('SMTP connection refused') })
    );
  });

  it('logs success when the email service resolves { success: true }', async () => {
    mocks.useRealHelper.current = true;
    mocks.systemSendEmail.mockResolvedValue({ success: true });

    await cancelSubscriptionAction();

    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.stringContaining('Cancellation request email sent')
    );
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });
});
