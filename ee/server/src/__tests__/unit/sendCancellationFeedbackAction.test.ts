import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkAccountManagementPermission: vi.fn(),
  getConnection: vi.fn(),
  getSession: vi.fn(),
  sendCancellationFeedbackEmail: vi.fn(),
}));

vi.mock('../../lib/license/get-license-usage', () => ({ getLicenseUsage: vi.fn() }));

vi.mock('@alga-psa/auth', () => ({ getSession: mocks.getSession }));

vi.mock('@alga-psa/auth/actions', () => ({
  checkAccountManagementPermission: mocks.checkAccountManagementPermission,
}));

vi.mock('../../lib/stripe/StripeService', () => ({
  AppleIapBillingError: class AppleIapBillingError extends Error {},
  getStripeService: vi.fn(),
}));

vi.mock('@/lib/db/db', () => ({ getConnection: mocks.getConnection }));

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@alga-psa/email/sendCancellationRequestEmail', () => ({
  sendCancellationRequestEmail: vi.fn(),
}));

vi.mock('@alga-psa/email', () => ({
  sendCancellationFeedbackEmail: mocks.sendCancellationFeedbackEmail,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (tableName: string) => {
      if (tableName === 'stripe_subscriptions') {
        return {
          whereIn: () => ({
            first: async () => ({
              stripe_price_id: 'price-1',
              quantity: 3,
              current_period_end: '2026-09-01T00:00:00.000Z',
            }),
          }),
        };
      }

      if (tableName === 'stripe_prices') {
        return {
          where: () => ({ first: async () => ({ unit_amount: 2500 }) }),
        };
      }

      if (tableName === 'tenants') {
        return {
          first: async () => ({ client_name: 'Test Tenant', email: 'owner@example.test' }),
        };
      }

      throw new Error(`Unexpected table: ${tableName}`);
    },
  }),
}));

import { sendCancellationFeedbackAction } from '../../lib/actions/license-actions';

describe('sendCancellationFeedbackAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { tenant: 'tenant-1', email: 'session@example.test' },
    });
    mocks.checkAccountManagementPermission.mockResolvedValue(true);
    mocks.getConnection.mockResolvedValue({});
    mocks.sendCancellationFeedbackEmail.mockResolvedValue(undefined);
  });

  it('rejects an unknown category before lookup or email dispatch', async () => {
    const reasonCategory = 'Not a category';
    const reasonText = 'Optional feedback';
    const result = await sendCancellationFeedbackAction(reasonText, reasonCategory);

    expect(result).toEqual({
      success: false,
      error: 'Invalid cancellation feedback',
    });
    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(mocks.sendCancellationFeedbackEmail).not.toHaveBeenCalled();
  });

  it('accepts blank feedback without a category', async () => {
    const result = await sendCancellationFeedbackAction('', undefined);

    expect(result).toEqual({ success: true });
    expect(mocks.sendCancellationFeedbackEmail).toHaveBeenCalledWith(
      expect.objectContaining({ reasonText: '', reasonCategory: undefined })
    );
  });

  it('sends trimmed, validated feedback to the mailer', async () => {
    const result = await sendCancellationFeedbackAction(
      '  The reporting workflow was too difficult to configure.  ',
      'Missing features I need'
    );

    expect(result).toEqual({ success: true });
    expect(mocks.sendCancellationFeedbackEmail).toHaveBeenCalledWith({
      tenantName: 'Test Tenant',
      tenantEmail: 'owner@example.test',
      reasonText: 'The reporting workflow was too difficult to configure.',
      reasonCategory: 'Missing features I need',
      licenseCount: 3,
      monthlyCost: 75,
      cancelAt: expect.any(String),
    });
  });
});
