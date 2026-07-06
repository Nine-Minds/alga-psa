import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(),
  publishEvent: vi.fn(),
  computeWorkDateFields: vi.fn(),
  resolveUserTimeZone: vi.fn(),
  writeEntityMapping: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({
    table: (tableExpr: string) => {
      const builder = conn(tableExpr);
      if (!builder || typeof builder.where !== 'function') {
        return builder;
      }
      const aliasMatch = /\bas\s+([A-Za-z0-9_]+)\s*$/i.exec(tableExpr.trim());
      const tenantColumn = aliasMatch ? `${aliasMatch[1]}.tenant` : 'tenant';
      builder.where({ [tenantColumn]: tenant });
      return {
        ...builder,
        where: (criteria: any, ...rest: any[]) =>
          criteria && typeof criteria === 'object' && !Array.isArray(criteria)
            ? builder.where({ [tenantColumn]: tenant, ...criteria })
            : builder.where(criteria, ...rest),
      };
    },
    scoped: (t: string) => conn(t),
    subquery: (t: string) => conn(t),
    parentScopedTable: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
    tenantJoinSubquery: (q: any, sub: any, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(sub) ?? q) : (q.join?.(sub) ?? q),
    tenantWhereColumn: (q: any) => q,
  }),
  computeWorkDateFields: mocks.computeWorkDateFields,
  createTenantKnex: mocks.createTenantKnex,
  resolveUserTimeZone: mocks.resolveUserTimeZone,
  withTransaction: mocks.withTransaction,
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: mocks.publishEvent,
}));

vi.mock('@alga-psa/shared/inboundWebhooks/externalEntityMappings', () => ({
  writeEntityMapping: mocks.writeEntityMapping,
}));

async function loadTimeEntryInboundActions() {
  vi.resetModules();
  await import('@alga-psa/scheduling/actions/inboundActions');
  return import('@alga-psa/shared/inboundWebhooks/actions/registry');
}

function createQuery(firstValue: unknown, returningValue: unknown[] = []) {
  return {
    where: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(firstValue),
    insert: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returningValue),
  };
}

describe('time entry inbound webhook actions', () => {
  let trx: ReturnType<typeof vi.fn> & { fn: { now: ReturnType<typeof vi.fn> } };
  let timeEntriesQuery: ReturnType<typeof createQuery>;
  let queriesByTable: Record<string, ReturnType<typeof createQuery>>;

  beforeEach(() => {
    vi.clearAllMocks();
    timeEntriesQuery = createQuery(null, [
      {
        entry_id: 'entry-1',
        work_item_id: 'ticket-1',
        work_item_type: 'ticket',
        billable_duration: 90,
        created_at: 'created-at',
      },
    ]);
    queriesByTable = {
      users: createQuery({ user_id: 'user-1' }),
      service_catalog: createQuery({ service_id: 'service-1' }),
      tickets: createQuery({ ticket_id: 'ticket-1' }),
      time_periods: createQuery({ period_id: 'period-1' }),
      time_sheets: createQuery({ id: 'sheet-1' }),
      time_entries: timeEntriesQuery,
    };
    trx = Object.assign(
      vi.fn((table: string) => {
        const query = queriesByTable[table];
        if (query) {
          return query;
        }
        throw new Error(`Unexpected table ${table}`);
      }),
      {
        fn: {
          now: vi.fn(() => 'db-now'),
        },
      },
    );
    mocks.createTenantKnex.mockResolvedValue({ knex: 'tenant-knex' });
    mocks.withTransaction.mockImplementation(async (_knex: unknown, callback: (transaction: unknown) => unknown) =>
      callback(trx),
    );
    mocks.resolveUserTimeZone.mockResolvedValue('America/New_York');
    mocks.computeWorkDateFields.mockReturnValue({
      work_date: '2026-05-11',
      work_timezone: 'America/New_York',
    });
  });

  it('T1060: createTimeEntry creates a mapped time entry and publishes the standard event', async () => {
    const { getAction } = await loadTimeEntryInboundActions();
    const action = getAction('createTimeEntry');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'time-feed',
          deliveryId: 'delivery-1',
          headers: {},
          rawBody: { time: { id: 'time-42', ticket: 'ticket-1' } },
          idempotencyKey: 'time-42',
        },
        {
          external_id: 'time-42',
          user_id: 'user-1',
          work_item_type: 'ticket',
          work_item_id: 'ticket-1',
          service_id: 'service-1',
          start_time: '2026-05-11T13:00:00.000Z',
          duration_minutes: 90,
          notes: 'Remote remediation',
          is_billable: true,
          tax_region: 'NY',
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'time_entry',
      entityId: 'entry-1',
      externalId: 'time-42',
      metadata: {
        billable_duration: 90,
        work_item_type: 'ticket',
      },
    });

    expect(queriesByTable.users.where).toHaveBeenCalledWith({ tenant: 'tenant-a', user_id: 'user-1' });
    expect(queriesByTable.service_catalog.where).toHaveBeenCalledWith({
      tenant: 'tenant-a',
      service_id: 'service-1',
    });
    expect(queriesByTable.tickets.where).toHaveBeenCalledWith({ tenant: 'tenant-a', ticket_id: 'ticket-1' });
    expect(queriesByTable.time_periods.where).toHaveBeenCalledWith({ tenant: 'tenant-a' });
    expect(queriesByTable.time_sheets.where).toHaveBeenCalledWith({
      tenant: 'tenant-a',
      period_id: 'period-1',
      user_id: 'user-1',
    });
    expect(timeEntriesQuery.insert).toHaveBeenCalledWith({
      tenant: 'tenant-a',
      user_id: 'user-1',
      work_item_id: 'ticket-1',
      work_item_type: 'ticket',
      service_id: 'service-1',
      start_time: '2026-05-11T13:00:00.000Z',
      end_time: '2026-05-11T14:30:00.000Z',
      work_date: '2026-05-11',
      work_timezone: 'America/New_York',
      billable_duration: 90,
      notes: 'Remote remediation',
      time_sheet_id: 'sheet-1',
      approval_status: 'DRAFT',
      tax_region: 'NY',
      invoiced: false,
      created_by: 'user-1',
      updated_by: 'user-1',
      created_at: 'db-now',
      updated_at: 'db-now',
    });
    expect(mocks.writeEntityMapping).toHaveBeenCalledWith(
      'tenant-a',
      'time-feed',
      'time_entry',
      'entry-1',
      'time-42',
      {
        knex: trx,
        metadata: {
          source: 'inbound_webhook',
          delivery_id: 'delivery-1',
        },
      },
    );
    expect(mocks.publishEvent).toHaveBeenCalledWith({
      eventType: 'TIME_ENTRY_CREATED',
      payload: expect.objectContaining({
        tenantId: 'tenant-a',
        timeEntryId: 'entry-1',
        userId: 'user-1',
        workItemId: 'ticket-1',
        workItemType: 'ticket',
        duration: 90,
      }),
    });
  });
});
