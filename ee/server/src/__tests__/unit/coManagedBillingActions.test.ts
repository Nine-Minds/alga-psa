import { beforeEach, describe, expect, it, vi } from 'vitest';
import { previewCoManagedSeatsAction, purchaseCoManagedSeatsAction } from '../../lib/actions/coManagedBillingActions';

const mocks = vi.hoisted(() => ({ permission: vi.fn(), preview: vi.fn(), purchase: vi.fn(), key: vi.fn(),
  user: { user_id: 'actor', tenant: 'authenticated-sponsor', user_type: 'internal' } }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: any) => (...args: any[]) =>
  handler(mocks.user, { tenant: mocks.user.tenant }, ...args) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.permission }));
vi.mock('../../lib/stripe/StripeService', () => ({ getStripeService: () => ({
  previewCoManagedSeats: mocks.preview, purchaseCoManagedSeats: mocks.purchase, getPublishableKey: mocks.key,
}) }));

beforeEach(() => {
  vi.resetAllMocks(); mocks.user.user_type = 'internal'; mocks.permission.mockResolvedValue(true);
  mocks.purchase.mockResolvedValue({ kind: 'updated', subscriptionId: 'subscription' });
});

describe('co-managed billing authorization', () => {
  it('requires billing update permission for previews and charges', async () => {
    mocks.permission.mockResolvedValue(false);
    await expect(previewCoManagedSeatsAction(3)).rejects.toThrow('Permission denied');
    await expect(purchaseCoManagedSeatsAction({ quantity: 3, operationId: 'operation' })).rejects.toThrow('Permission denied');
    expect(mocks.permission).toHaveBeenCalledWith(mocks.user, 'account_management', 'update');
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.purchase).not.toHaveBeenCalled();
  });
  it('denies a requester even if a permission adapter returns an allow', async () => {
    mocks.user.user_type = 'client';
    await expect(purchaseCoManagedSeatsAction({ quantity: 3, operationId: 'operation' })).rejects.toThrow('Permission denied');
    expect(mocks.purchase).not.toHaveBeenCalled();
  });
  it('uses the authenticated sponsor, ignoring a caller-supplied tenant', async () => {
    await purchaseCoManagedSeatsAction({ quantity: 3, operationId: 'operation', tenant: 'other-sponsor' } as any);
    expect(mocks.purchase).toHaveBeenCalledWith('authenticated-sponsor', 3, 'operation');
    expect(mocks.key).not.toHaveBeenCalled();
  });
  it('returns the publishable key only when opening checkout', async () => {
    mocks.purchase.mockResolvedValue({ kind: 'checkout', sessionId: 'session', clientSecret: 'secret' });
    mocks.key.mockResolvedValue('pk_test_public');
    expect(await purchaseCoManagedSeatsAction({ quantity: 3, operationId: 'operation' })).toEqual({
      kind: 'checkout', sessionId: 'session', clientSecret: 'secret', publishableKey: 'pk_test_public',
    });
  });
});
