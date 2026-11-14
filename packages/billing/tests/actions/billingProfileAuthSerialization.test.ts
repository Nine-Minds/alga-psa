import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class AuthenticationError extends Error {
    constructor() {
      super('User not authenticated');
      this.name = 'AuthenticationError';
    }
  }
  return {
    AuthenticationError,
    withAuthRejected: () => async () => { throw new AuthenticationError(); },
  };
});

vi.mock('@alga-psa/auth', () => ({
  AuthenticationError: mocks.AuthenticationError,
  withAuth: mocks.withAuthRejected,
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/auth/withAuth', () => ({ withAuth: mocks.withAuthRejected }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  tenantDb: vi.fn(),
  withTransaction: vi.fn(),
}));
vi.mock('@alga-psa/shared/billingClients/billingProfiles', () => ({
  listClientBillingProfiles: vi.fn(),
}));

import { getClientBillingProfilesForBilling } from '../../src/actions/billingProfileActions';
import { getClientByIdForBillingRecoverable } from '../../src/actions/billingClientsActions';
import { getServicesRecoverable } from '../../src/actions/serviceActions';
import { getActiveClientLocationsForBillingRecoverable } from '../../src/actions/billingClientLocationActions';
import { getInvoiceAdjustmentCapability } from '../../src/actions/invoiceModification';
import {
  getEnrichedInvoiceViewModel,
  getInvoiceLineItems,
  getInvoicePurchaseOrderSummary,
  getResolvedInvoiceTemplateId,
} from '../../src/actions/invoiceQueries';

describe('invoice read authentication serialization', () => {
  it.each([
    ['billing clients', () => getClientByIdForBillingRecoverable('client-1')],
    ['service catalog', () => getServicesRecoverable(1, 999, { item_kind: 'any' })],
    ['client locations', () => getActiveClientLocationsForBillingRecoverable('client-1')],
    ['billing profiles', () => getClientBillingProfilesForBilling('client-1')],
    ['adjustment capability', () => getInvoiceAdjustmentCapability('invoice-1')],
    ['invoice detail', () => getEnrichedInvoiceViewModel('invoice-1')],
    ['invoice line items', () => getInvoiceLineItems('invoice-1')],
    ['purchase order summary', () => getInvoicePurchaseOrderSummary('invoice-1')],
    ['template selection', () => getResolvedInvoiceTemplateId('invoice-1')],
  ])('returns a JSON-safe unauthenticated result when the actual %s action rejects', async (_name, runAction) => {
    const result = await runAction();
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      success: false,
      code: 'UNAUTHENTICATED',
      params: {},
      message: 'Authentication required',
      error: 'Authentication required',
    });
  });
});
