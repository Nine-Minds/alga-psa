import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;
let clientIdForCurrentUser: string | null;
let billingPermissionGranted = true;
let quoteStore: Record<string, any>;
let quoteActivityLog: any[];
let quoteItemUpdateLog: Array<{ criteria: Record<string, unknown>; payload: Record<string, unknown> }>;
let rawQuoteUpdateLog: Array<{ criteria: Record<string, unknown>; payload: Record<string, unknown> }>;
// Records every table scoped through the tenantDb facade so tenant-isolation can still
// be asserted now that tenant scoping lives inside tenantDb(trx, tenant) rather than in
// each query's WHERE/criteria.
let tenantScopeLog: Array<{ tenant: string; table: string }> = [];

const getConnectionMock = vi.fn();
const withTransactionMock = vi.fn();
const listByClientMock = vi.fn();
const getByIdMock = vi.fn();
const updateQuoteMock = vi.fn();
const createQuoteActivityMock = vi.fn();
const recalculateQuoteFinancialsMock = vi.fn();
const onQuoteAcceptedMock = vi.fn();
const updateIfStatusMock = vi.fn();
let quoteDecisionInsertLog: Array<Record<string, unknown>>;

const recordQuoteLifecycleMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@alga-psa/shared/lib/quotes/quoteLifecycleEvents', () => ({ recordQuoteLifecycleTransition: (...args: any[]) => recordQuoteLifecycleMock(...args) }));

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
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => {
      tenantScopeLog.push({ tenant, table });
      return conn(table);
    },
    unscoped: (table: string) => conn(table),
    tenantJoin: (query: any, _table?: string, _left?: string, _right?: string, options: any = {}) => {
      const join = options?.type === 'left' ? query.leftJoin : query.join;
      return typeof join === 'function' ? join.call(query) : query;
    },
  }),
}));

vi.mock('@alga-psa/billing/models/quote', () => ({
  default: {
    listByClient: (...args: any[]) => listByClientMock(...args),
    getById: (...args: any[]) => getByIdMock(...args),
    update: (...args: any[]) => updateQuoteMock(...args),
    updateIfStatus: (...args: any[]) => updateIfStatusMock(...args),
  },
}));

vi.mock('@alga-psa/opportunities/lib/quoteLifecycleHooks', () => ({
  onQuoteAccepted: (...args: any[]) => onQuoteAcceptedMock(...args),
}));

vi.mock('@alga-psa/billing/models/quoteActivity', () => ({
  default: {
    create: (...args: any[]) => createQuoteActivityMock(...args),
  },
}));

// The decision service imports the calculation service directly, not via the barrel.
vi.mock('../../../../billing/src/services/quoteCalculationService', () => ({
  recalculateQuoteFinancials: (...args: any[]) => recalculateQuoteFinancialsMock(...args),
}));

vi.mock('@alga-psa/billing/services', async () => ({
  // Real decision service + portal access rule; only the collaborators below are doubles.
  ...(await import('../../../../billing/src/services/quoteDecisionService')),
  recalculateQuoteFinancials: (...args: any[]) => recalculateQuoteFinancialsMock(...args),
  resolveQuoteItemTaxesIfIncluded: async () =>
    new Map([
      ['item-required', 0],
      ['item-optional', 0],
    ]),
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

      if (table === 'users') {
        const chain: any = {};
        chain.where = vi.fn(() => chain);
        chain.select = vi.fn(() => chain);
        chain.first = vi.fn(async () => ({ user_id: currentUser.user_id, contact_id: currentUser.contact_id }));
        return chain;
      }

      if (table === 'quote_decisions') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => ({
            returning: vi.fn(async () => {
              quoteDecisionInsertLog.push(row);
              return [{ decision_id: `decision-${quoteDecisionInsertLog.length}` }];
            }),
          })),
        };
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
        chain.forUpdate = vi.fn(() => chain);
        chain.first = vi.fn(async () => quoteStore[String(criteria.quote_id)]);
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
    recordQuoteLifecycleMock.mockClear();
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
    quoteDecisionInsertLog = [];
    tenantScopeLog = [];

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
    updateIfStatusMock.mockImplementation(async (_db: any, _tenant: string, quoteId: string, expected: string, payload: Record<string, unknown>) => {
      const quote = quoteStore[quoteId];
      if (!quote || quote.status !== expected) {
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

  it('T097: toggling optional items is a local preview — no per-toggle action exists and loading the quote writes nothing', async () => {
    const actions = await import('./client-billing');

    expect((actions as Record<string, unknown>).updateClientQuoteSelections).toBeUndefined();

    const before = clone(quoteStore['quote-1']);
    const quote = await actions.getClientQuoteById('quote-1');

    expect(quoteItemUpdateLog).toEqual([]);
    expect(recalculateQuoteFinancialsMock).not.toHaveBeenCalled();
    expect(quoteStore['quote-1'].quote_items).toEqual(before.quote_items);
    expect(quoteStore['quote-1'].total_amount).toBe(before.total_amount);
    // The payload carries the server-resolved inputs the local preview needs.
    expect(quote.quote_items?.every((item) => typeof item.tax_amount_if_included === 'number')).toBe(true);
  });

  it('T097a: the vendor selection is what a reload returns until Accept', async () => {
    const { getClientQuoteById } = await import('./client-billing');

    await getClientQuoteById('quote-1');
    const reloadedQuote = await getClientQuoteById('quote-1');

    expect(reloadedQuote.quote_items?.find((item) => item.quote_item_id === 'item-optional')?.is_selected).toBe(true);
    expect(reloadedQuote.total_amount).toBe(20000);
    expect(quoteItemUpdateLog).toEqual([]);
  });

  it('T098: acceptClientQuote persists exactly the given selection, updates totals and records the activity', async () => {
    const { acceptClientQuote } = await import('./client-billing');

    const acceptedQuote = await acceptClientQuote('quote-1', []);

    expect(acceptedQuote.status).toBe('accepted');
    expect(acceptedQuote.accepted_by).toBe('portal-user-1');
    expect(acceptedQuote.accepted_at).toEqual(expect.any(String));
    // Selection persisted for every optional row, then totals recalculated.
    expect(quoteItemUpdateLog).toEqual([
      {
        criteria: { quote_item_id: 'item-optional' },
        payload: { is_selected: false, updated_at: 'db-now' },
      },
    ]);
    expect(tenantScopeLog).toContainEqual({ tenant: 'tenant-1', table: 'quote_items' });
    expect(recalculateQuoteFinancialsMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'quote-1');
    expect(acceptedQuote.total_amount).toBe(15000);
    expect(createQuoteActivityMock).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      expect.objectContaining({
        quote_id: 'quote-1',
        activity_type: 'accepted',
        metadata: {
          selected_optional_quote_item_ids: [],
          deselected_optional_quote_item_ids: ['item-optional'],
        },
      })
    );
  });

  it('T098a: accepting with the optional item selected keeps it and records it as selected', async () => {
    const { acceptClientQuote } = await import('./client-billing');

    const acceptedQuote = await acceptClientQuote('quote-1', ['item-optional']);

    expect(acceptedQuote.status).toBe('accepted');
    expect(acceptedQuote.total_amount).toBe(20000);
    expect(createQuoteActivityMock).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      expect.objectContaining({
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

    await expect(rejectClientQuote('quote-1', '   ')).resolves.toEqual({
      actionError: 'A rejection comment is required',
      messageKey: 'client-portal:errors.billing.rejectionCommentRequired',
    });

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

  it('golden: portal accept writes the exact pre-refactor activity, calls the hook once, and audits method=portal', async () => {
    const { acceptClientQuote } = await import('./client-billing');

    const acceptedQuote = await acceptClientQuote('quote-1', ['item-optional']);

    expect(quoteActivityLog).toEqual([
      {
        quote_id: 'quote-1',
        activity_type: 'accepted',
        description: 'Quote accepted by client for MSP review',
        performed_by: 'portal-user-1',
        metadata: {
          selected_optional_quote_item_ids: ['item-optional'],
          deselected_optional_quote_item_ids: [],
        },
      },
    ]);
    expect(updateIfStatusMock).toHaveBeenCalledWith(
      expect.anything(), 'tenant-1', 'quote-1', 'sent',
      { status: 'accepted', accepted_at: expect.any(String), accepted_by: 'portal-user-1', updated_by: 'portal-user-1' },
      // The portal user acts as their contact on the lifecycle event (QUOTE_ACCEPTED/QUOTE_REJECTED).
      { actor: { actorType: 'CONTACT', actorContactId: 'contact-1' }, acceptedOnBehalf: false },
    );
    expect(onQuoteAcceptedMock).toHaveBeenCalledTimes(1);
    expect(onQuoteAcceptedMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ quote_id: 'quote-1', status: 'accepted' }));
    expect(acceptedQuote.quote_id).toBe('quote-1');
    expect(quoteDecisionInsertLog).toHaveLength(1);
    expect(quoteDecisionInsertLog[0]).toMatchObject({
      tenant: 'tenant-1', quote_id: 'quote-1', decision: 'accepted', method: 'portal',
      actor_user_id: 'portal-user-1', contact_id: null, link_id: null,
    });
  });

  it('golden: portal reject writes the exact pre-refactor activity and never fires the accepted hook', async () => {
    const { rejectClientQuote } = await import('./client-billing');

    await rejectClientQuote('quote-1', '  Budget is not approved yet.  ');

    expect(quoteActivityLog).toEqual([
      {
        quote_id: 'quote-1',
        activity_type: 'rejected',
        description: 'Quote rejected by client',
        performed_by: 'portal-user-1',
        metadata: { rejection_reason: 'Budget is not approved yet.' },
      },
    ]);
    expect(updateIfStatusMock).toHaveBeenCalledWith(
      expect.anything(), 'tenant-1', 'quote-1', 'sent',
      { status: 'rejected', rejected_at: expect.any(String), rejection_reason: 'Budget is not approved yet.', updated_by: 'portal-user-1' },
      // The portal user acts as their contact on the lifecycle event (QUOTE_ACCEPTED/QUOTE_REJECTED).
      { actor: { actorType: 'CONTACT', actorContactId: 'contact-1' }, acceptedOnBehalf: false },
    );
    expect(onQuoteAcceptedMock).not.toHaveBeenCalled();
    expect(quoteDecisionInsertLog[0]).toMatchObject({ decision: 'rejected', method: 'portal', comment: 'Budget is not approved yet.' });
  });

  it('golden: a decided or foreign quote writes nothing and keeps the portal error strings', async () => {
    const { acceptClientQuote } = await import('./client-billing');

    await expect(acceptClientQuote('quote-2', [])).resolves.toEqual({
      actionError: 'Quote is not in a valid state for this action',
      messageKey: 'client-portal:errors.billing.quoteInvalidState',
    });
    await expect(acceptClientQuote('quote-other-client', [])).resolves.toEqual({
      actionError: 'Quote not found or access denied',
      messageKey: 'client-portal:errors.billing.quoteNotFound',
    });
    billingPermissionGranted = false;
    await expect(acceptClientQuote('quote-1', [])).resolves.toEqual({
      permissionError: 'Unauthorized to access quote data',
      messageKey: 'client-portal:errors.access.quoteData',
    });
    expect(quoteActivityLog).toEqual([]);
    expect(quoteDecisionInsertLog).toEqual([]);
    expect(onQuoteAcceptedMock).not.toHaveBeenCalled();
  });

  it('T101: first client quote view stamps viewed_at and logs activity', async () => {
    const { getClientQuoteById } = await import('./client-billing');

    const viewedQuote = await getClientQuoteById('quote-1');

    expect(viewedQuote.viewed_at).toEqual(expect.any(String));
    expect(recordQuoteLifecycleMock).toHaveBeenCalledOnce();
    // Tenant scoping now lives in the tenantDb facade, so the criteria no longer
    // carries tenant; assert the facade scoped the quotes table to this tenant.
    expect(rawQuoteUpdateLog).toContainEqual({
      criteria: { quote_id: 'quote-1' },
      payload: { viewed_at: viewedQuote.viewed_at, updated_at: 'db-now', updated_by: 'portal-user-1' },
    });
    expect(tenantScopeLog).toContainEqual({ tenant: 'tenant-1', table: 'quotes' });
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
    expect(recordQuoteLifecycleMock).not.toHaveBeenCalled();
    expect(rawQuoteUpdateLog).toHaveLength(0);
    expect(createQuoteActivityMock).not.toHaveBeenCalled();
  });

  it('T103: expired quotes cannot be accepted or rejected from the portal', async () => {
    quoteStore['quote-1'].status = 'expired';
    const { acceptClientQuote, rejectClientQuote } = await import('./client-billing');

    await expect(acceptClientQuote('quote-1', ['item-optional'])).resolves.toEqual({
      actionError: 'Quote is not in a valid state for this action',
      messageKey: 'client-portal:errors.billing.quoteInvalidState',
    });
    await expect(rejectClientQuote('quote-1', 'Too late')).resolves.toEqual({
      actionError: 'Quote is not in a valid state for this action',
      messageKey: 'client-portal:errors.billing.quoteInvalidState',
    });
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
    docAssocQuery.first = vi.fn(async () => ({ file_id: 'stored-pdf-file-1', document_name: 'Managed Services Proposal.pdf' }));

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

    expect(result).toEqual({ success: true, fileId: 'stored-pdf-file-1', fileName: 'Managed Services Proposal.pdf' });
  });

  it('regenerates a stored quote PDF after its title has changed', async () => {
    const docAssocQuery: any = {};
    docAssocQuery.join = vi.fn(() => docAssocQuery);
    docAssocQuery.where = vi.fn(() => docAssocQuery);
    docAssocQuery.whereNotNull = vi.fn(() => docAssocQuery);
    docAssocQuery.orderBy = vi.fn(() => docAssocQuery);
    docAssocQuery.select = vi.fn(() => docAssocQuery);
    docAssocQuery.first = vi.fn(async () => ({ file_id: 'old-pdf-file', document_name: 'Old quote title.pdf' }));

    getConnectionMock.mockResolvedValue(
      Object.assign((table: string) => {
        if (table === 'document_associations as da') return docAssocQuery;
        throw new Error(`Unexpected table: ${table}`);
      }, { tenant: 'tenant-1' })
    );
    const generateAndStore = vi.fn(async () => ({ file_id: 'new-pdf-file' }));
    vi.doMock('@alga-psa/billing/services', async () => ({
      ...(await import('../../../../billing/src/services/quoteDecisionService')),
      recalculateQuoteFinancials: (...args: any[]) => recalculateQuoteFinancialsMock(...args),
      resolveQuoteItemTaxesIfIncluded: async () =>
        new Map([
          ['item-required', 0],
          ['item-optional', 0],
        ]),
      createPDFGenerationService: vi.fn(() => ({ generateAndStore })),
    }));

    const { downloadClientQuotePdf } = await import('./client-billing');
    const result = await downloadClientQuotePdf('quote-1');

    expect(generateAndStore).toHaveBeenCalledWith({ quoteId: 'quote-1', quoteNumber: 'Q-0001', userId: 'portal-user-1' });
    expect(result).toEqual({ success: true, fileId: 'new-pdf-file', fileName: 'Managed Services Proposal.pdf' });
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
    vi.doMock('@alga-psa/billing/services', async () => ({
      ...(await import('../../../../billing/src/services/quoteDecisionService')),
      recalculateQuoteFinancials: (...args: any[]) => recalculateQuoteFinancialsMock(...args),
      resolveQuoteItemTaxesIfIncluded: async () =>
        new Map([
          ['item-required', 0],
          ['item-optional', 0],
        ]),
      createPDFGenerationService: vi.fn(() => ({
        generateAndStore: vi.fn(async () => ({ file_id: 'generated-pdf-file-1' })),
      })),
    }));

    const { downloadClientQuotePdf } = await import('./client-billing');
    const result = await downloadClientQuotePdf('quote-1');

    expect(result).toEqual({ success: true, fileId: expect.any(String), fileName: 'Managed Services Proposal.pdf' });
  });

  it('T138: downloadClientQuotePdf rejects access to other client\'s quotes', async () => {
    const { downloadClientQuotePdf } = await import('./client-billing');

    const result = await downloadClientQuotePdf('quote-other-client');

    expect(result).toEqual({ actionError: 'Quote not found or access denied', messageKey: 'client-portal:errors.billing.quoteNotFound' });
  });

  it('T139: downloadClientQuotePdf rejects access to draft quotes', async () => {
    const { downloadClientQuotePdf } = await import('./client-billing');

    const result = await downloadClientQuotePdf('quote-draft');

    expect(result).toEqual({ actionError: 'Quote not found or access denied', messageKey: 'client-portal:errors.billing.quoteNotFound' });
  });

  it('T140: downloadClientQuotePdf rejects unauthenticated users', async () => {
    clientIdForCurrentUser = null;

    const { downloadClientQuotePdf } = await import('./client-billing');

    const result = await downloadClientQuotePdf('quote-1');

    expect(result).toEqual({ permissionError: 'Unauthorized', messageKey: 'client-portal:errors.access.unauthorized' });
  });
});
