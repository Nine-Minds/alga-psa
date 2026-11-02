import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gateway, getConnection } = vi.hoisted(() => ({
  gateway: {
    getVerifiedAccountId: vi.fn(),
    listCustomersForImport: vi.fn(),
    getCustomerImportSnapshot: vi.fn(),
    updateCustomerMetadata: vi.fn(),
    updateSavedPaymentMethodMetadata: vi.fn(),
    capabilities: () => ({ supportedCurrencies: ['USD'] }),
  },
  getConnection: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@/lib/db', () => ({ createTenantKnex: vi.fn(async () => ({ knex: {} })) }));
vi.mock('@alga-psa/db', () => ({ getConnection, tenantDb: vi.fn() }));
vi.mock('@alga-psa/clients/actions', () => ({ setClientAutopay: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../lib/payments/StripePaymentProvider', () => ({ createStripePaymentProvider: () => gateway }));

import {
  executeStripeImportAction,
  previewStripeImportAction,
  proposeStripeImportMatchesAction,
} from '../../../lib/actions/stripe-import-actions';

const actionCases = [
  ['no-tenant-stripe-account', 'This tenant has no Stripe account configured. Connect a tenant Stripe account in Billing settings to enable imports.'],
  ['account-unbound', 'The tenant Stripe account has not been verified. Reconnect Stripe in Billing settings before importing.'],
  ['account-mismatch', 'The saved Stripe credentials now point to a different account than the tenant’s verified binding. Restore the bound account credentials or contact support.'],
] as const;

const actions = [
  ['preview', () => previewStripeImportAction({ rows: [] })],
  ['propose', () => proposeStripeImportMatchesAction()],
  ['execute', () => executeStripeImportAction({ rows: [], planDigest: '', attestedRowIds: [] })],
] as const;

describe('Stripe import action configuration errors', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(actionCases.flatMap(([code, message]) => actions.map(([name, invoke]) => ({ code, message, name, invoke }))))(
    '$name returns an actionable $code message before Stripe customer access',
    async ({ code, message, invoke }) => {
      gateway.getVerifiedAccountId.mockRejectedValueOnce(new Error(`stripe-import/${code}`));

      const result = await invoke();

      expect(result).toMatchObject({ success: false, code: `stripe-import/${code}`, error: message });
      expect(getConnection).not.toHaveBeenCalled();
      expect(gateway.listCustomersForImport).not.toHaveBeenCalled();
      expect(gateway.getCustomerImportSnapshot).not.toHaveBeenCalled();
      expect(gateway.updateCustomerMetadata).not.toHaveBeenCalled();
      expect(gateway.updateSavedPaymentMethodMetadata).not.toHaveBeenCalled();
    },
  );
});
