import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;
let clientIdForCurrentUser: string | null;
let billingPermissionGranted: boolean;
let transactionRows: any[];
let txQuery: any;

const getConnectionMock = vi.fn();
const withTransactionMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: (...args: any[]) => getConnectionMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  createTenantKnex: vi.fn(),
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
    tenantJoin: (query: any, _table?: string, _left?: string, _right?: string, options: any = {}) => {
      const join = options?.type === 'left' ? query.leftJoin : query.join;
      return typeof join === 'function' ? join.call(query) : query;
    },
  }),
}));

vi.mock('./clientBillingPermissions', () => ({
  getClientIdFromPortalUser: vi.fn(async () => clientIdForCurrentUser),
  hasClientBillingReadPermission: vi.fn(async () => billingPermissionGranted),
}));

vi.mock('@alga-psa/billing/models/quote', () => ({ default: {} }));
vi.mock('@alga-psa/billing/models/quoteActivity', () => ({ default: {} }));
vi.mock('@alga-psa/billing/services', () => ({ recalculateQuoteFinancials: vi.fn() }));
vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  fetchInvoicesByClient: vi.fn().mockResolvedValue([]),
  getInvoiceLineItems: vi.fn().mockResolvedValue([]),
  getInvoiceForRendering: vi.fn(),
}));
vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({
  getInvoiceTemplates: vi.fn().mockResolvedValue([]),
}));
vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({
  finalizeInvoice: vi.fn(),
  unfinalizeInvoice: vi.fn(),
}));
vi.mock('@alga-psa/billing/actions/invoiceJobActions', () => ({
  scheduleInvoiceEmailAction: vi.fn(),
  scheduleInvoiceZipAction: vi.fn(),
}));
vi.mock('@alga-psa/billing/models/invoice', () => ({ default: {} }));
vi.mock('@alga-psa/jobs', () => ({
  JobService: class {},
  JobStatus: {},
}));

function buildTransactionQuery() {
  const chain: any = {};
  chain.where = vi.fn((criteria: Record<string, unknown>) => {
    chain.lastWhere = criteria;
    return chain;
  });
  chain.whereIn = vi.fn((column: string, values: string[]) => {
    chain.lastWhereIn = { column, values };
    return chain;
  });
  chain.select = vi.fn(() => chain);
  chain.orderBy = vi.fn((column: string, direction?: string) => {
    chain.lastOrderBy = { column, direction };
    return chain;
  });
  chain.limit = vi.fn((count: number) => {
    chain.lastLimit = count;
    return chain;
  });
  chain.leftJoin = vi.fn(() => chain);
  chain.join = vi.fn(() => chain);
  chain.then = (onFulfilled: any, onRejected: any) => Promise.resolve(transactionRows).then(onFulfilled, onRejected);
  chain.catch = (onRejected: any) => Promise.resolve(transactionRows).catch(onRejected);
  chain.finally = (handler: any) => Promise.resolve(transactionRows).finally(handler);
  return chain;
}

function buildTrx(query: any) {
  return Object.assign(
    (table: string) => {
      if (table === 'transactions as t') {
        return query;
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    {
      fn: { now: () => 'db-now' },
    }
  ) as any;
}

const clientBillingSource = readFileSync(new URL('./client-billing.ts', import.meta.url), 'utf8');

describe('getClientCreditHistory portal action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    currentUser = {
      user_id: 'portal-user-1',
      user_type: 'client',
      contact_id: 'contact-1',
      email: 'client@example.com',
      tenant: 'tenant-1',
    };
    clientIdForCurrentUser = 'client-1';
    billingPermissionGranted = true;
    transactionRows = [
      {
        transaction_id: 'tx-issuance',
        type: 'credit_issuance',
        description: 'Prepayment credit',
        amount: 10000,
        balance_after: 15000,
        created_at: '2026-07-01T10:00:00.000Z',
        invoice_id: 'inv-1',
        currency_code: 'USD',
        invoice_number: 'INV-001',
      },
      {
        transaction_id: 'tx-application',
        type: 'credit_application',
        description: 'Applied to invoice',
        amount: -5000,
        balance_after: 10000,
        created_at: '2026-07-05T10:00:00.000Z',
        invoice_id: 'inv-2',
        currency_code: 'USD',
        invoice_number: 'INV-002',
      },
      {
        transaction_id: 'tx-expiration',
        type: 'credit_expiration',
        description: 'Credit expired',
        amount: -2000,
        balance_after: null,
        created_at: '2026-07-10T10:00:00.000Z',
        invoice_id: null,
        currency_code: null,
        invoice_number: null,
      },
    ];
    txQuery = buildTransactionQuery();

    getConnectionMock.mockResolvedValue({ tenant: 'tenant-1' });
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback(buildTrx(txQuery))
    );
  });

  it('T141: returns typed ledger rows including the left-joined invoice number', async () => {
    const { getClientCreditHistory } = await import('./client-billing');

    const result = await getClientCreditHistory();

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      transaction_id: 'tx-issuance',
      type: 'credit_issuance',
      description: 'Prepayment credit',
      amount: 10000,
      balance_after: 15000,
      created_at: '2026-07-01T10:00:00.000Z',
      invoice_id: 'inv-1',
      invoice_number: 'INV-001',
      currency_code: 'USD',
    });
    expect(result[1].invoice_number).toBe('INV-002');
    expect(result[2]).toEqual({
      transaction_id: 'tx-expiration',
      type: 'credit_expiration',
      description: 'Credit expired',
      amount: -2000,
      balance_after: null,
      created_at: '2026-07-10T10:00:00.000Z',
      invoice_id: null,
      invoice_number: null,
      currency_code: null,
    });
  });

  it('T142: scopes the query to the portal client and tenant', async () => {
    const { getClientCreditHistory } = await import('./client-billing');

    await getClientCreditHistory();

    expect(txQuery.where).toHaveBeenCalledWith({
      't.client_id': 'client-1',
      't.tenant': 'tenant-1',
    });
    expect(txQuery.leftJoin).toHaveBeenCalledTimes(1);
  });

  it('T143: filters to credit-bearing types only — never payment or invoice_generated', async () => {
    expect(clientBillingSource).toContain("'credit_issuance'");
    expect(clientBillingSource).toContain("'prepayment'");
    expect(clientBillingSource).toContain("'credit_application'");
    expect(clientBillingSource).toContain("'credit_issuance_from_negative_invoice'");
    expect(clientBillingSource).not.toContain("'payment'");
    expect(clientBillingSource).not.toContain("'invoice_generated'");

    const { getClientCreditHistory } = await import('./client-billing');

    await getClientCreditHistory();

    const whereIn = txQuery.whereIn.mock.calls[0];
    expect(whereIn[0]).toBe('t.type');
    for (const type of [
      'credit_issuance',
      'prepayment',
      'credit_application',
      'credit_adjustment',
      'credit_expiration',
      'credit_transfer',
      'credit_issuance_from_negative_invoice',
    ]) {
      expect(whereIn[1]).toContain(type);
    }
    expect(whereIn[1]).not.toContain('payment');
    expect(whereIn[1]).not.toContain('invoice_generated');
  });

  it('T144: orders newest first and caps the ledger at 20 rows', async () => {
    const { getClientCreditHistory } = await import('./client-billing');

    await getClientCreditHistory();

    expect(txQuery.orderBy).toHaveBeenCalledWith('t.created_at', 'desc');
    expect(txQuery.limit).toHaveBeenCalledWith(20);
  });

  it('T146: does not expose MSP-internal transaction fields', async () => {
    const { getClientCreditHistory } = await import('./client-billing');

    await getClientCreditHistory();

    const select = txQuery.select.mock.calls[0][0];
    expect(select).not.toContain('metadata');
    expect(select).not.toContain('parent_transaction_id');
    expect(select).not.toContain('related_transaction_id');
  });

  it('T147: returns a permission error (not a throw) when billing read is denied', async () => {
    billingPermissionGranted = false;
    const { getClientCreditHistory } = await import('./client-billing');

    await expect(getClientCreditHistory()).resolves.toEqual({
      permissionError: 'Unauthorized to access billing data',
    });
  });

  it('T148: returns a permission error when the portal user has no client', async () => {
    clientIdForCurrentUser = null;
    const { getClientCreditHistory } = await import('./client-billing');

    await expect(getClientCreditHistory()).resolves.toEqual({
      permissionError: 'Unauthorized',
    });
  });
});
