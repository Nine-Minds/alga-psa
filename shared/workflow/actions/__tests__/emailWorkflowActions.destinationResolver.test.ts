import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueryPlanRow = {
  table: string;
  where: Record<string, unknown>;
  row: any;
};

const withAdminTransactionMock = vi.fn();
let trxImpl: any = null;

vi.mock('@alga-psa/db', () => ({
  withAdminTransaction: (callback: (trx: any) => Promise<any>) =>
    withAdminTransactionMock(callback),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

function whereMatches(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function createTrxForQueryPlan(plan: QueryPlanRow[]) {
  const tablesCalled: string[] = [];

  const trx = (table: string) => {
    tablesCalled.push(table);
    let whereClause: Record<string, unknown> = {};
    const builder: any = {
      select: vi.fn(() => builder),
      where: vi.fn((value: Record<string, unknown>) => {
        whereClause = value ?? {};
        return builder;
      }),
      first: vi.fn(async () => {
        const match = plan.find((entry) => entry.table === table && whereMatches(whereClause, entry.where));
        return match?.row ?? null;
      }),
    };

    return builder;
  };

  return { trx, tablesCalled };
}

describe('resolveEffectiveInboundTicketDefaults precedence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) =>
      callback(trxImpl)
    );
  });

  it('T005: exact sender contact with contact override selects contact destination', async () => {
    const contactDefaults = {
      board_id: 'board-contact-1',
      status_id: 'status-1',
      priority_id: 'priority-1',
      client_id: 'client-contact',
      entered_by: 'user-1',
      category_id: null,
      subcategory_id: null,
      location_id: null,
    };

    const { trx, tablesCalled } = createTrxForQueryPlan([
      {
        table: 'contacts',
        where: { tenant: 'tenant-1', contact_name_id: 'contact-1' },
        row: { inbound_ticket_defaults_id: 'defaults-contact-1', client_id: 'client-contact' },
      },
      {
        table: 'inbound_ticket_defaults',
        where: { tenant: 'tenant-1', id: 'defaults-contact-1', is_active: true },
        row: contactDefaults,
      },
    ]);
    trxImpl = trx;

    const { resolveEffectiveInboundTicketDefaults } = await import('../emailWorkflowActions');
    const result = await resolveEffectiveInboundTicketDefaults({
      tenant: 'tenant-1',
      providerId: 'provider-1',
      providerDefaults: {
        board_id: 'board-provider',
        status_id: 'status-provider',
        priority_id: 'priority-provider',
      },
      matchedContactId: 'contact-1',
      matchedContactClientId: 'client-contact',
      domainMatchedClientId: null,
    });

    expect(result.source).toBe('contact_override');
    expect(result.defaults).toEqual(contactDefaults);
    expect(result.fallbackReason).toBeUndefined();
    expect(tablesCalled).not.toContain('clients');
  });

  it("T006: exact sender contact without override selects contact's client destination", async () => {
    const clientDefaults = {
      board_id: 'board-client-1',
      status_id: 'status-1',
      priority_id: 'priority-1',
      client_id: 'client-2',
      entered_by: 'user-1',
      category_id: null,
      subcategory_id: null,
      location_id: null,
    };

    const { trx, tablesCalled } = createTrxForQueryPlan([
      {
        table: 'contacts',
        where: { tenant: 'tenant-1', contact_name_id: 'contact-2' },
        row: { inbound_ticket_defaults_id: null, client_id: 'client-2' },
      },
      {
        table: 'clients',
        where: { tenant: 'tenant-1', client_id: 'client-2' },
        row: { inbound_ticket_defaults_id: 'defaults-client-2' },
      },
      {
        table: 'inbound_ticket_defaults',
        where: { tenant: 'tenant-1', id: 'defaults-client-2', is_active: true },
        row: clientDefaults,
      },
    ]);
    trxImpl = trx;

    const { resolveEffectiveInboundTicketDefaults } = await import('../emailWorkflowActions');
    const result = await resolveEffectiveInboundTicketDefaults({
      tenant: 'tenant-1',
      providerId: 'provider-1',
      providerDefaults: {
        board_id: 'board-provider',
        status_id: 'status-provider',
        priority_id: 'priority-provider',
      },
      matchedContactId: 'contact-2',
      matchedContactClientId: 'client-2',
      domainMatchedClientId: null,
    });

    expect(result.source).toBe('client_default_from_contact');
    expect(result.defaults).toEqual(clientDefaults);
    expect(result.fallbackReason).toBeUndefined();
    expect(tablesCalled).toContain('clients');
  });

  it('T007: no exact contact + domain-matched client selects domain client destination', async () => {
    const domainClientDefaults = {
      board_id: 'board-domain-1',
      status_id: 'status-1',
      priority_id: 'priority-1',
      client_id: 'client-domain-1',
      entered_by: 'user-1',
      category_id: null,
      subcategory_id: null,
      location_id: null,
    };

    const { trx, tablesCalled } = createTrxForQueryPlan([
      {
        table: 'clients',
        where: { tenant: 'tenant-1', client_id: 'client-domain-1' },
        row: { inbound_ticket_defaults_id: 'defaults-domain-1' },
      },
      {
        table: 'inbound_ticket_defaults',
        where: { tenant: 'tenant-1', id: 'defaults-domain-1', is_active: true },
        row: domainClientDefaults,
      },
    ]);
    trxImpl = trx;

    const { resolveEffectiveInboundTicketDefaults } = await import('../emailWorkflowActions');
    const result = await resolveEffectiveInboundTicketDefaults({
      tenant: 'tenant-1',
      providerId: 'provider-1',
      providerDefaults: {
        board_id: 'board-provider',
        status_id: 'status-provider',
        priority_id: 'priority-provider',
      },
      matchedContactId: null,
      matchedContactClientId: null,
      domainMatchedClientId: 'client-domain-1',
    });

    expect(result.source).toBe('client_default_from_domain');
    expect(result.defaults).toEqual(domainClientDefaults);
    expect(result.fallbackReason).toBeUndefined();
    expect(tablesCalled).not.toContain('contacts');
  });
});
