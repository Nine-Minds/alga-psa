import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;
let clientIdForCurrentUser: string | null;
let billingPermissionGranted = true;
let quoteStore: Record<string, any>;
let quoteActivityLog: any[];
let quoteItemUpdateLog: Array<{ criteria: Record<string, unknown>; payload: Record<string, unknown> }>;
let rawQuoteUpdateLog: Array<{ criteria: Record<string, unknown>; payload: Record<string, unknown> }>;

const getConnectionMock = vi.fn();
const withTransactionMock = vi.fn();
const listByClientMock = vi.fn();
const getByIdMock = vi.fn();
const updateQuoteMock = vi.fn();
const createQuoteActivityMock = vi.fn();
const recalculateQuoteFinancialsMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (action: any) =>
    async (...args: any[]) =>
      action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: (...args: any[]) => getConnectionMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  createTenantKnex: vi.fn(),
}));

vi.mock('@alga-psa/billing/models/quote', () => ({
  default: {
    listByClient: (...args: any[]) => listByClientMock(...args),
    getById: (...args: any[]) => getByIdMock(...args),
    update: (...args: any[]) => updateQuoteMock(...args),
  },
}));

vi.mock('@alga-psa/billing/models/quoteActivity', () => ({
  default: {
    create: (...args: any[]) => createQuoteActivityMock(...args),
  },
}));

vi.mock('@alga-psa/billing/services', () => ({
  recalculateQuoteFinancials: (...args: any[]) => recalculateQuoteFinancialsMock(...args),
}));

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

vi.mock('@alga-psa/billing/models/invoice', () => ({
  default: {},
}));

vi.mock('@alga-psa/jobs', () => ({
  JobService: class {},
  JobStatus: {},
}));

function clone<T>(value: T): T {
  return structuredClone(value);
}

function makeQuote(overrides: Record<string, any> = {}) {
  const quote = {
    tenant: 'tenant-1',
    quote_id: 'quote-1',
    quote_number: 'Q-0001',
    client_id: 'client-1',
    title: 'Managed Services Proposal',
    status: 'sent',
    is_template: false,
    viewed_at: null,
    accepted_at: null,
    accepted_by: null,
    rejected_at: null,
    rejection_reason: null,
    subtotal: 20000,
    discount_total: 0,
    tax: 0,
    total_amount: 20000,
    quote_items: [
      {
        quote_item_id: 'item-required',
        quote_id: 'quote-1',
        description: 'Core monitoring',
        quantity: 1,
        unit_price: 15000,
        total_price: 15000,
        net_amount: 15000,
        tax_amount: 0,
        is_optional: false,
        is_selected: true,
        is_recurring: true,
      },
      {
        quote_item_id: 'item-optional',
        quote_id: 'quote-1',
        description: 'Optional onboarding',
        quantity: 1,
        unit_price: 5000,
        total_price: 5000,
        net_amount: 5000,
        tax_amount: 0,
        is_optional: true,
        is_selected: true,
        is_recurring: false,
      },
    ],
    ...overrides,
  };

  return quote;
}

function recalculateStoredQuote(quoteId: string) {
  const quote = quoteStore[quoteId];
  if (!quote) {
    return null;
  }

  const activeItems = (quote.quote_items || []).filter((item: any) => !item.is_optional || item.is_selected !== false);
  const subtotal = activeItems.reduce((sum: number, item: any) => sum + Number(item.total_price || 0), 0);
  const tax = activeItems.reduce((sum: number, item: any) => sum + Number(item.tax_amount || 0), 0);
  quote.subtotal = subtotal;
  quote.tax = tax;
  quote.discount_total = 0;
  quote.total_amount = subtotal + tax;
  return quote;
}

function buildTrx() {
  return Object.assign(
    (table: string) => {
      if (table === 'contacts') {
        const chain: any = {};
        chain.where = vi.fn(() => chain);
        chain.select = vi.fn(() => chain);
        chain.first = vi.fn(async () =>
          clientIdForCurrentUser ? { client_id: clientIdForCurrentUser } : undefined
        );
        return chain;
      }

      if (table === 'role_permissions as rp') {
        const chain: any = {};
        chain.join = vi.fn(() => chain);
        chain.where = vi.fn(() => chain);
        chain.first = vi.fn(async () =>
          billingPermissionGranted ? { permission_id: 'perm-1' } : undefined
        );
        return chain;
      }

      if (table === 'quote_items') {
        return {
          where: vi.fn((criteria: Record<string, unknown>) => ({
            update: vi.fn(async (payload: Record<string, unknown>) => {
              quoteItemUpdateLog.push({ criteria, payload });
              const item = Object.values(quoteStore)
                .flatMap((quote: any) => quote.quote_items || [])
                .find((quoteItem: any) => quoteItem.quote_item_id === criteria.quote_item_id);

              if (!item) {
                return 0;
              }

              Object.assign(item, payload);
              return 1;
            }),
          })),
        };
      }

      if (table === 'quotes') {
        const chain: any = {};
        let criteria: Record<string, unknown> = {};
        let requiredNullField: string | null = null;
        chain.where = vi.fn((nextCriteria: Record<string, unknown>) => {
          criteria = { ...criteria, ...nextCriteria };
          return chain;
        });
        chain.whereNull = vi.fn((field: string) => {
          requiredNullField = field;
          return chain;
        });
        chain.update = vi.fn(async (payload: Record<string, unknown>) => {
          rawQuoteUpdateLog.push({ criteria, payload });
          const quote = quoteStore[String(criteria.quote_id)];
          if (!quote) {
            return 0;
          }
          if (requiredNullField && quote[requiredNullField] != null) {
            return 0;
          }
          Object.assign(quote, payload);
          return 1;
        });
        return chain;
      }

      throw new Error(`Unexpected table: ${table}`);
    },
    {
      fn: {
        now: () => 'db-now',
      },
    }
  ) as any;
}

describe('client quote billing actions', () => {
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
    quoteStore = {
      'quote-1': makeQuote(),
      'quote-2': makeQuote({
        quote_id: 'quote-2',
        quote_number: 'Q-0002',
        title: 'Already accepted quote',
        status: 'accepted',
        total_amount: 12000,
        subtotal: 12000,
        quote_items: [],
      }),
      'quote-draft': makeQuote({
        quote_id: 'quote-draft',
        quote_number: 'Q-0003',
        title: 'Draft quote',
        status: 'draft',
      }),
      'quote-other-client': makeQuote({
        quote_id: 'quote-other-client',
        quote_number: 'Q-9001',
        client_id: 'client-2',
        title: 'Other client quote',
      }),
    };
    quoteActivityLog = [];
    quoteItemUpdateLog = [];
    rawQuoteUpdateLog = [];

    getConnectionMock.mockResolvedValue({ tenant: 'tenant-1' });
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(buildTrx()));
    listByClientMock.mockImplementation(async (_db: any, _tenant: string, clientId: string) =>
      Object.values(quoteStore)
        .filter((quote: any) => quote.client_id === clientId)
        .map((quote: any) => clone(quote))
    );
    getByIdMock.mockImplementation(async (_db: any, _tenant: string, quoteId: string) => {
      const quote = quoteStore[quoteId];
      return quote ? clone(quote) : null;
    });
    updateQuoteMock.mockImplementation(async (_db: any, _tenant: string, quoteId: string, payload: Record<string, unknown>) => {
      const quote = quoteStore[quoteId];
      if (!quote) {
        return null;
      }
      Object.assign(quote, payload);
      return clone(quote);
    });
    createQuoteActivityMock.mockImplementation(async (_db: any, _tenant: string, payload: Record<string, unknown>) => {
      quoteActivityLog.push(payload);
      return { activity_id: `activity-${quoteActivityLog.length}`, ...payload };
    });
    recalculateQuoteFinancialsMock.mockImplementation(async (_db: any, _tenant: string, quoteId: string) => {
      recalculateStoredQuote(quoteId);
      return clone(quoteStore[quoteId]);
    });
  });

  it('T094: getClientQuotes returns the authenticated client\'s non-draft quotes', async () => {
    const { getClientQuotes } = await import('./client-billing');

    const quotes = await getClientQuotes();

    expect(quotes.map((quote) => quote.quote_id)).toEqual(['quote-1', 'quote-2']);
    expect(quotes.every((quote) => quote.status !== 'draft')).toBe(true);
  });

  it('T095: getClientQuotes scopes the query to the authenticated client', async () => {
    const { getClientQuotes } = await import('./client-billing');

    await getClientQuotes();

    expect(listByClientMock).toHaveBeenCalledWith(
      { tenant: 'tenant-1' },
      'tenant-1',
      'client-1'
    );
    expect(listByClientMock).not.toHaveBeenCalledWith(
      { tenant: 'tenant-1' },
      'tenant-1',
      'client-2'
    );
  });

  it('T096: getClientQuoteById returns full quote details including optional item flags', async () => {
    const { getClientQuoteById } = await import('./client-billing');

    const quote = await getClientQuoteById('quote-1');

    expect(quote.quote_items).toHaveLength(2);
    expect(quote.quote_items?.find((item) => item.quote_item_id === 'item-optional')).toMatchObject({
      is_optional: true,
      description: 'Optional onboarding',
    });
  });

  it('T097: updateClientQuoteSelections persists optional selections and recalculates totals', async () => {
    const { updateClientQuoteSelections } = await import('./client-billing');

    const updatedQuote = await updateClientQuoteSelections('quote-1', []);

    expect(quoteItemUpdateLog).toContainEqual({
      criteria: { tenant: 'tenant-1', quote_item_id: 'item-optional' },
      payload: { is_selected: false, updated_at: 'db-now' },
    });
    expect(recalculateQuoteFinancialsMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'quote-1');
    expect(updatedQuote.quote_items?.find((item) => item.quote_item_id === 'item-optional')?.is_selected).toBe(false);
    expect(updatedQuote.total_amount).toBe(15000);
  });

  it('T097a: optional quote selections persist across a follow-up reload', async () => {
    const { getClientQuoteById, updateClientQuoteSelections } = await import('./client-billing');

    await updateClientQuoteSelections('quote-1', []);
    const reloadedQuote = await getClientQuoteById('quote-1');

    expect(reloadedQuote.quote_items?.find((item) => item.quote_item_id === 'item-optional')?.is_selected).toBe(false);
    expect(reloadedQuote.total_amount).toBe(15000);
  });

  it('T098: acceptClientQuote persists selections and marks the quote as accepted', async () => {
    const { acceptClientQuote } = await import('./client-billing');

    const acceptedQuote = await acceptClientQuote('quote-1', ['item-optional']);

    expect(acceptedQuote.status).toBe('accepted');
    expect(acceptedQuote.accepted_by).toBe('portal-user-1');
    expect(acceptedQuote.accepted_at).toEqual(expect.any(String));
    expect(createQuoteActivityMock).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      expect.objectContaining({
        quote_id: 'quote-1',
        activity_type: 'accepted',
        metadata: {
          selected_optional_quote_item_ids: ['item-optional'],
          deselected_optional_quote_item_ids: [],
        },
      })
    );
  });

  it('T100: rejectClientQuote requires a comment and stores rejection metadata', async () => {
    const { rejectClientQuote } = await import('./client-billing');

    await expect(rejectClientQuote('quote-1', '   ')).rejects.toThrow('A rejection comment is required');

    const rejectedQuote = await rejectClientQuote('quote-1', '  Budget is not approved yet.  ');

    expect(rejectedQuote.status).toBe('rejected');
    expect(rejectedQuote.rejection_reason).toBe('Budget is not approved yet.');
    expect(rejectedQuote.rejected_at).toEqual(expect.any(String));
    expect(createQuoteActivityMock).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      expect.objectContaining({
        quote_id: 'quote-1',
        activity_type: 'rejected',
        metadata: { rejection_reason: 'Budget is not approved yet.' },
      })
    );
  });

  it('T101: first client quote view stamps viewed_at and logs activity', async () => {
    const { getClientQuoteById } = await import('./client-billing');

    const viewedQuote = await getClientQuoteById('quote-1');

    expect(viewedQuote.viewed_at).toEqual(expect.any(String));
    expect(rawQuoteUpdateLog).toContainEqual({
      criteria: { tenant: 'tenant-1', quote_id: 'quote-1' },
      payload: { viewed_at: viewedQuote.viewed_at, updated_at: 'db-now', updated_by: 'portal-user-1' },
    });
    expect(createQuoteActivityMock).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      expect.objectContaining({
        quote_id: 'quote-1',
        activity_type: 'viewed',
      })
    );
  });

  it('T102: second client quote view leaves the original viewed_at timestamp untouched', async () => {
    quoteStore['quote-1'].viewed_at = '2026-03-13T10:00:00.000Z';
    const { getClientQuoteById } = await import('./client-billing');

    const viewedQuote = await getClientQuoteById('quote-1');

    expect(viewedQuote.viewed_at).toBe('2026-03-13T10:00:00.000Z');
    expect(rawQuoteUpdateLog).toHaveLength(0);
    expect(createQuoteActivityMock).not.toHaveBeenCalled();
  });

  it('T103: expired quotes cannot be accepted or rejected from the portal', async () => {
    quoteStore['quote-1'].status = 'expired';
    const { acceptClientQuote, rejectClientQuote } = await import('./client-billing');

    await expect(acceptClientQuote('quote-1', ['item-optional'])).rejects.toThrow('Failed to accept quote');
    await expect(rejectClientQuote('quote-1', 'Too late')).rejects.toThrow('Failed to reject quote');
    expect(updateQuoteMock).not.toHaveBeenCalled();
  });

  it('T136: downloadClientQuotePdf returns stored file_id when PDF exists', async () => {
    // Add a document association query mock to the trx builder
    const origBuildTrx = buildTrx;
    const docAssocQuery: any = {};
    docAssocQuery.join = vi.fn(() => docAssocQuery);
    docAssocQuery.where = vi.fn(() => docAssocQuery);
    docAssocQuery.whereNotNull = vi.fn(() => docAssocQuery);
    docAssocQuery.orderBy = vi.fn(() => docAssocQuery);
    docAssocQuery.select = vi.fn(() => docAssocQuery);
    docAssocQuery.first = vi.fn(async () => ({ file_id: 'stored-pdf-file-1' }));

    getConnectionMock.mockResolvedValue(
      Object.assign(
        (table: string) => {
          if (table === 'document_associations as da') {
            return docAssocQuery;
          }
          throw new Error(`Unexpected table: ${table}`);
        },
        { tenant: 'tenant-1' }
      )
    );

    const { downloadClientQuotePdf } = await import('./client-billing');
    const result = await downloadClientQuotePdf('quote-1');

    expect(result).toEqual({ success: true, fileId: 'stored-pdf-file-1' });
  });

  it('T137: downloadClientQuotePdf generates PDF on the fly when none stored', async () => {
    const docAssocQuery: any = {};
    docAssocQuery.join = vi.fn(() => docAssocQuery);
    docAssocQuery.where = vi.fn(() => docAssocQuery);
    docAssocQuery.whereNotNull = vi.fn(() => docAssocQuery);
    docAssocQuery.orderBy = vi.fn(() => docAssocQuery);
    docAssocQuery.select = vi.fn(() => docAssocQuery);
    docAssocQuery.first = vi.fn(async () => undefined);

    getConnectionMock.mockResolvedValue(
      Object.assign(
        (table: string) => {
          if (table === 'document_associations as da') {
            return docAssocQuery;
          }
          throw new Error(`Unexpected table: ${table}`);
        },
        { tenant: 'tenant-1' }
      )
    );

    // Mock the dynamic import of billing services — include recalculateQuoteFinancials
    // to avoid breaking other tests that depend on the same mock
    vi.doMock('@alga-psa/billing/services', () => ({
      recalculateQuoteFinancials: (...args: any[]) => recalculateQuoteFinancialsMock(...args),
      createPDFGenerationService: vi.fn(() => ({
        generateAndStore: vi.fn(async () => ({ file_id: 'generated-pdf-file-1' })),
      })),
    }));

    const { downloadClientQuotePdf } = await import('./client-billing');
    const result = await downloadClientQuotePdf('quote-1');

    expect(result).toEqual({ success: true, fileId: expect.any(String) });
  });

  it('T138: downloadClientQuotePdf rejects access to other client\'s quotes', async () => {
    const { downloadClientQuotePdf } = await import('./client-billing');

    const result = await downloadClientQuotePdf('quote-other-client');

    expect(result).toEqual({ success: false, error: 'Failed to download quote PDF' });
  });

  it('T139: downloadClientQuotePdf rejects access to draft quotes', async () => {
    const { downloadClientQuotePdf } = await import('./client-billing');

    const result = await downloadClientQuotePdf('quote-draft');

    expect(result).toEqual({ success: false, error: 'Failed to download quote PDF' });
  });

  it('T140: downloadClientQuotePdf rejects unauthenticated users', async () => {
    clientIdForCurrentUser = null;

    const { downloadClientQuotePdf } = await import('./client-billing');

    const result = await downloadClientQuotePdf('quote-1');

    expect(result).toEqual({ success: false, error: 'Failed to download quote PDF' });
  });
});
