import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A manual invoice can be raised against any of the client's billing profiles —
 * the case that matters is a profile that arrived with a merged client, which
 * must bill under the target client and never under its original owner.
 */

const mocks = vi.hoisted(() => {
  const warn = vi.fn();
  const error = vi.fn();
  const hasPermission = vi.fn(async () => true);
  const insert = vi.fn(async () => undefined);
  const profileRow = vi.fn(() => ({ client_id: 'client-1', is_active: true }));

  const makeBuilder = (table: string) => {
    const builder: any = {
      where: vi.fn(() => builder),
      andWhere: vi.fn(() => builder),
      select: vi.fn(() => builder),
      first: vi.fn(async () => (table === 'client_billing_profiles' ? profileRow() : undefined)),
      insert,
    };
    return builder;
  };

  const trx = vi.fn((table: string) => makeBuilder(table));
  const transaction = vi.fn(async (callback: (transaction: typeof trx) => Promise<unknown>) => callback(trx));
  const knex: any = vi.fn((table: string) => makeBuilder(table));
  knex.transaction = transaction;

  const validateSessionAndTenant = vi.fn(async () => ({
    session: { user: { id: 'session-user-1' } },
    knex,
  }));
  const getClientDetails = vi.fn(async () => ({
    client_id: 'client-1',
    client_name: 'Northstar Dental Group',
    default_currency_code: 'USD',
  }));
  const validateClientBillingEmail = vi.fn(async () => ({ valid: true }));
  const persistManualInvoiceCharges = vi.fn(async () => undefined);
  const calculateAndDistributeTax = vi.fn(async () => undefined);
  const updateInvoiceTotalsAndRecordTransaction = vi.fn(async () => undefined);
  const getFullInvoiceById = vi.fn(async () => ({
    invoice_id: 'invoice-1',
    subtotal: 1000,
    tax: 0,
    total_amount: 1000,
    invoice_charges: [],
  }));

  return {
    warn,
    error,
    hasPermission,
    insert,
    profileRow,
    trx,
    transaction,
    knex,
    validateSessionAndTenant,
    getClientDetails,
    validateClientBillingEmail,
    persistManualInvoiceCharges,
    calculateAndDistributeTax,
    updateInvoiceTotalsAndRecordTransaction,
    getFullInvoiceById,
  };
});

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    warn: mocks.warn,
    error: mocks.error,
  },
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) => action({ user_id: 'auth-user-1' }, { tenant: 'tenant-1' }, ...args),
  getSession: vi.fn(async () => ({ user: { id: 'session-user-1' } })),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('../../../../../packages/billing/src/services/invoiceService', () => ({
  validateSessionAndTenant: mocks.validateSessionAndTenant,
  getClientDetails: mocks.getClientDetails,
  getClientBillingEmail: vi.fn(async () => null),
  validateClientBillingEmail: mocks.validateClientBillingEmail,
  persistManualInvoiceCharges: mocks.persistManualInvoiceCharges,
  calculateAndDistributeTax: mocks.calculateAndDistributeTax,
  updateInvoiceTotalsAndRecordTransaction: mocks.updateInvoiceTotalsAndRecordTransaction,
}));

vi.mock('../../../../../packages/billing/src/models/invoice', () => ({
  default: { getFullInvoiceById: mocks.getFullInvoiceById },
}));

vi.mock('../../../../../packages/billing/src/actions/invoiceGeneration', () => ({
  generateInvoiceNumber: vi.fn(async () => 'INV-001'),
}));

vi.mock('../../../../../packages/billing/src/actions/taxSourceActions', () => ({
  getInitialInvoiceTaxSource: vi.fn(async () => 'internal'),
}));

vi.mock('../../../../../packages/billing/src/actions/billingAndTax', () => ({
  getDueDate: vi.fn(async () => '2026-09-30'),
}));

vi.mock('../../../../../packages/billing/src/lib/authHelpers', () => ({
  getAnalyticsAsync: vi.fn(async () => ({
    analytics: { capture: vi.fn() },
    AnalyticsEvents: { INVOICE_GENERATED: 'INVOICE_GENERATED' },
  })),
}));

vi.mock('../../../../../packages/billing/src/services/taxService', () => ({
  TaxService: class {},
}));

const { generateManualInvoice } = await import(
  '../../../../../packages/billing/src/actions/manualInvoiceActions'
);

const request = {
  clientId: 'client-1',
  items: [{ service_id: 'service-1', quantity: 1, description: 'Setup', rate: 1000 }],
};

describe('generateManualInvoice billing profile selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.validateClientBillingEmail.mockResolvedValue({ valid: true });
    mocks.profileRow.mockReturnValue({ client_id: 'client-1', is_active: true });
  });

  it('bills the selected profile and attributes every line to it', async () => {
    const result = await generateManualInvoice({ ...request, billingProfileId: 'profile-merged' });

    expect(result.success).toBe(true);
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ billing_profile_id: 'profile-merged' }),
    );
    expect(mocks.persistManualInvoiceCharges).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      [expect.objectContaining({ billing_profile_id: 'profile-merged' })],
      expect.anything(),
      expect.anything(),
      'tenant-1',
    );
  });

  it('keeps a per-line profile override ahead of the invoice profile', async () => {
    const result = await generateManualInvoice({
      ...request,
      billingProfileId: 'profile-merged',
      items: [{ ...request.items[0], billing_profile_id: 'profile-line' }],
    });

    expect(result.success).toBe(true);
    expect(mocks.persistManualInvoiceCharges).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      [expect.objectContaining({ billing_profile_id: 'profile-line' })],
      expect.anything(),
      expect.anything(),
      'tenant-1',
    );
  });

  it('refuses a profile that belongs to another client', async () => {
    mocks.profileRow.mockReturnValue({ client_id: 'client-2', is_active: true });

    const result = await generateManualInvoice({ ...request, billingProfileId: 'profile-elsewhere' });

    expect(result).toMatchObject({
      success: false,
      code: 'BILLING_PROFILE_NOT_FOUND',
      params: { billingProfileId: 'profile-elsewhere' },
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('refuses an archived profile', async () => {
    mocks.profileRow.mockReturnValue({ client_id: 'client-1', is_active: false });

    const result = await generateManualInvoice({ ...request, billingProfileId: 'profile-archived' });

    expect(result).toMatchObject({ success: false, code: 'BILLING_PROFILE_NOT_FOUND' });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('leaves an unpicked invoice attributed exactly as before', async () => {
    const result = await generateManualInvoice(request);

    expect(result.success).toBe(true);
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ billing_profile_id: null }),
    );
    // Untouched items: charge attribution still falls through to the client default.
    expect(mocks.persistManualInvoiceCharges).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      request.items,
      expect.anything(),
      expect.anything(),
      'tenant-1',
    );
  });
});
