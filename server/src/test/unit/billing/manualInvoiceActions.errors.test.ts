import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualInvoiceError } from '../../../../../packages/billing/src/errors/manualInvoiceErrors';

const mocks = vi.hoisted(() => {
  const warn = vi.fn();
  const error = vi.fn();
  const hasPermission = vi.fn(async () => true);
  const insert = vi.fn(async () => undefined);
  const trx = vi.fn(() => {
    const builder = {
      where: vi.fn(() => builder),
      insert,
    };
    return builder;
  });
  const transaction = vi.fn(async (callback: (transaction: typeof trx) => Promise<unknown>) => callback(trx));
  const validateSessionAndTenant = vi.fn(async () => ({
    session: { user: { id: 'session-user-1' } },
    knex: { transaction },
  }));
  const getClientDetails = vi.fn(async () => ({
    client_id: 'client-1',
    client_name: 'Omni Energy Partners',
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
    trx,
    transaction,
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
  getDueDate: vi.fn(async () => '2026-08-13'),
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

describe('generateManualInvoice structured errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.validateClientBillingEmail.mockResolvedValue({ valid: true });
  });

  it('returns the billing-email code and client name and logs tenant/client/user context', async () => {
    mocks.validateClientBillingEmail.mockResolvedValueOnce({
      valid: false,
      code: 'NO_BILLING_EMAIL',
      params: { clientName: 'Omni Energy Partners' },
      error: 'Cannot generate invoice: No billing email address for "Omni Energy Partners".',
    });

    const result = await generateManualInvoice(request);

    expect(result).toMatchObject({
      success: false,
      code: 'NO_BILLING_EMAIL',
      params: { clientName: 'Omni Energy Partners' },
      error: expect.stringContaining('No billing email address'),
      message: expect.stringContaining('No billing email address'),
    });
    expect(mocks.warn).toHaveBeenCalledWith('[generateManualInvoice] NO_BILLING_EMAIL', {
      tenant: 'tenant-1',
      clientId: 'client-1',
      userId: 'session-user-1',
      clientName: 'Omni Energy Partners',
    });
  });

  it.each([
    ['CLIENT_NOT_FOUND', 'Client not found', {}],
    ['SERVICE_NOT_FOUND', 'Service not found: service-404', { serviceId: 'service-404' }],
    ['INVALID_QUANTITY', 'Quantity must be greater than 0', {}],
    ['DISCOUNT_TARGET_NOT_FOUND', 'Discount target not found', { serviceId: 'service-404' }],
  ] as const)('maps a %s domain error into the structured envelope', async (code, message, params) => {
    const domainError = new ManualInvoiceError(code, message, params);
    if (code === 'CLIENT_NOT_FOUND') {
      mocks.getClientDetails.mockRejectedValueOnce(domainError);
    } else {
      mocks.persistManualInvoiceCharges.mockRejectedValueOnce(domainError);
    }

    const result = await generateManualInvoice(request);

    expect(result).toMatchObject({ success: false, code, params, message, error: message });
    expect(mocks.warn).toHaveBeenCalledWith(
      `[generateManualInvoice] ${code}`,
      expect.objectContaining({ tenant: 'tenant-1', clientId: 'client-1' }),
    );
  });

  it('maps missing tax rates with region and date parameters', async () => {
    mocks.calculateAndDistributeTax.mockRejectedValueOnce(new ManualInvoiceError(
      'NO_TAX_RATE',
      'No active tax rate(s) found for region US-PA on date 2026-07-14',
      { region: 'US-PA', date: '2026-07-14' },
    ));

    const result = await generateManualInvoice(request);

    expect(result).toMatchObject({
      success: false,
      code: 'NO_TAX_RATE',
      params: { region: 'US-PA', date: '2026-07-14' },
    });
  });

  it('maps the invoice-number unique constraint to INVOICE_NUMBER_CONFLICT', async () => {
    mocks.insert.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'unique_invoice_number_per_tenant',
    }));

    const result = await generateManualInvoice(request);

    expect(result).toMatchObject({
      success: false,
      code: 'INVOICE_NUMBER_CONFLICT',
      message: 'Invoice number must be unique',
    });
  });

  it('returns and logs PERMISSION_DENIED without starting invoice work', async () => {
    mocks.hasPermission.mockResolvedValueOnce(false);

    const result = await generateManualInvoice(request);

    expect(result).toMatchObject({ success: false, code: 'PERMISSION_DENIED' });
    expect(mocks.validateSessionAndTenant).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(
      '[generateManualInvoice] PERMISSION_DENIED',
      expect.objectContaining({ tenant: 'tenant-1', clientId: 'client-1' }),
    );
  });

  it('returns a support reference and logs unexpected errors with the stack', async () => {
    mocks.persistManualInvoiceCharges.mockRejectedValueOnce(new Error('database unavailable'));

    const result = await generateManualInvoice(request);

    expect(result).toMatchObject({
      success: false,
      code: 'UNEXPECTED',
      ref: expect.stringMatching(/^[0-9a-f-]{8}$/),
    });
    expect(mocks.error).toHaveBeenCalledWith(
      '[generateManualInvoice] UNEXPECTED',
      expect.objectContaining({
        tenant: 'tenant-1',
        clientId: 'client-1',
        ref: expect.any(String),
        error: 'database unavailable',
        stack: expect.any(String),
      }),
    );
  });
});
