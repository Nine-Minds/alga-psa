import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const getVisibilityContextMock = vi.fn();
const applyTicketVisibilityFilterMock = vi.fn((query) => query);
const hasPermissionMock = vi.fn(async () => true);
const hasBillingReadPermissionMock = vi.fn(async () => true);

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
    tenantJoin: (query: any, _table?: string, _left?: string, _right?: string, options: any = {}) => {
      const join = options?.type === 'left' ? query.leftJoin : query.join;
      return typeof join === 'function' ? join.call(query) : query;
    },
  }),
}));

// The invoice tile and the invoice/quote activity ride on the portal billing
// gate, which lives in @alga-psa/billing and is re-exported here.
vi.mock('./clientBillingPermissions', () => ({
  hasClientBillingReadPermission: (...args: any[]) => hasBillingReadPermissionMock(...args),
  getClientIdFromPortalUser: vi.fn(),
}));

vi.mock('@alga-psa/tickets/lib', () => ({
  applyTicketVisibilityFilter: (...args: any[]) => applyTicketVisibilityFilterMock(...args),
}));

// The dashboard now imports the visibility context resolver from the `.server` subpath
// (@alga-psa/tickets/lib/clientPortalVisibility.server), so it must be mocked there.
vi.mock('@alga-psa/tickets/lib/clientPortalVisibility.server', () => ({
  getClientContactVisibilityContext: (...args: any[]) => getVisibilityContextMock(...args),
}));

describe('client portal dashboard visibility enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyTicketVisibilityFilterMock.mockImplementation((query) => query);
    hasPermissionMock.mockImplementation(async () => true);
    hasBillingReadPermissionMock.mockImplementation(async () => true);
    currentUser = {
      user_id: 'client-user-1',
      user_type: 'client',
      email: 'client@example.com',
      contact_id: 'contact-1',
      tenant: 'tenant-1',
    };
    createTenantKnexMock.mockResolvedValue({ knex: {} as any });
  });

  it('T017: ticket-backed dashboard counts respect the assigned visibility group boards', async () => {
    const ticketsQuery = {
      where: vi.fn().mockReturnThis(),
      count: vi.fn().mockResolvedValue([{ count: 4 }]),
    };

    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => {
      const trx = (table: string) => {
        if (table === 'contacts') {
          return {
            where: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                first: vi.fn().mockResolvedValue({ client_id: 'client-1' }),
              }),
            }),
          };
        }

        if (table === 'tickets') {
          return ticketsQuery;
        }

        // The active-devices count asks the registry which slugs are deployable.
        if (table === 'asset_statuses') {
          return {
            where: vi.fn().mockReturnValue({ pluck: vi.fn().mockResolvedValue(['active', 'in_stock']) }),
          };
        }

        if (
          table === 'projects' ||
          table === 'invoices' ||
          table === 'assets' ||
          table === 'service_request_submissions'
        ) {
          return {
            where: vi.fn().mockReturnThis(),
            whereNull: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            whereIn: vi.fn().mockReturnThis(),
            count: vi.fn().mockResolvedValue([{ count: 1 }]),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      };

      return callback(trx);
    });

    getVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-1'],
    });

    const { getDashboardMetrics } = await import('./dashboard');
    const metrics = await getDashboardMetrics();

    expect(applyTicketVisibilityFilterMock).toHaveBeenCalledWith(
      ticketsQuery,
      expect.objectContaining({ visibleBoardIds: ['board-1'] }),
      { boardColumn: 'tickets.board_id', contactColumn: 'tickets.contact_name_id', billingProfileColumn: 'tickets.billing_profile_id', watchListColumn: 'tickets.attributes' }
    );
    expect(metrics.openTickets).toBe(4);
  });

  it('skips the project count and project activity when the role lacks project:read', async () => {
    hasPermissionMock.mockImplementation(async (_user: any, resource: string) => resource !== 'project');

    const tablesQueried: string[] = [];
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback(Object.assign((table: string) => {
        tablesQueried.push(table);
        if (table === 'contacts') {
          return chain([{ client_id: 'client-1', contact_name_id: 'contact-1' }]);
        }
        if (table === 'projects') {
          return chain([{ name: 'Hidden rollout', timestamp: '2026-10-01T00:00:00Z' }]);
        }
        return chain([]);
      }, { raw: vi.fn() }))
    );

    getVisibilityContextMock.mockResolvedValue({
      contactId: 'contact-1',
      clientId: 'client-1',
      visibilityGroupId: 'group-1',
      visibleBoardIds: ['board-1'],
    });

    const { getDashboardMetrics, getRecentActivity } = await import('./dashboard');

    expect(await getDashboardMetrics()).toMatchObject({ activeProjects: 0 });
    // Fails closed before the query runs, not by filtering rows afterwards.
    expect(tablesQueried).not.toContain('projects');

    const activity = await getRecentActivity();
    expect(JSON.stringify(activity)).not.toContain('Hidden rollout');
    expect(tablesQueried).not.toContain('projects');
  });

  // alga-2026-0003317: the dashboard was the one portal surface that read
  // tickets, invoices and quotes with no RBAC gate at all, so a portal role
  // with every ticket permission unchecked still read colleagues' ticket
  // titles and comment excerpts off the landing page.
  it('skips the ticket count and ticket activity when the role lacks ticket:read', async () => {
    hasPermissionMock.mockImplementation(async (_user: any, resource: string) => resource !== 'ticket');

    const tablesQueried = buildPortalTrx();

    const { getDashboardMetrics, getRecentActivity } = await import('./dashboard');

    expect(await getDashboardMetrics()).toMatchObject({ openTickets: 0 });
    // Fails closed before the query runs, not by filtering rows afterwards.
    expect(tablesQueried).not.toContain('tickets');

    const activity = await getRecentActivity();
    expect(JSON.stringify(activity)).not.toContain('Hidden ticket');
    expect(tablesQueried).not.toContain('tickets');
  });

  it('skips the invoice count and invoice/quote activity when the role lacks billing:read', async () => {
    hasBillingReadPermissionMock.mockImplementation(async () => false);

    const tablesQueried = buildPortalTrx();

    const { getDashboardMetrics, getRecentActivity } = await import('./dashboard');

    expect(await getDashboardMetrics()).toMatchObject({ pendingInvoices: 0 });
    expect(tablesQueried).not.toContain('invoices');

    const activity = await getRecentActivity();
    expect(JSON.stringify(activity)).not.toContain('INV-HIDDEN');
    expect(JSON.stringify(activity)).not.toContain('Q-HIDDEN');
    expect(tablesQueried).not.toContain('invoices as inv');
    expect(tablesQueried).not.toContain('quotes');
  });

  it('keeps tickets, invoices and quotes for a role granted both permissions', async () => {
    const tablesQueried = buildPortalTrx();

    const { getDashboardMetrics, getRecentActivity } = await import('./dashboard');

    expect(await getDashboardMetrics()).toMatchObject({ openTickets: 1, pendingInvoices: 1 });
    expect(tablesQueried).toContain('tickets');
    expect(tablesQueried).toContain('invoices');

    const serialized = JSON.stringify(await getRecentActivity());
    expect(serialized).toContain('Hidden ticket');
    expect(serialized).toContain('INV-HIDDEN');
    expect(serialized).toContain('Q-HIDDEN');
  });
});

/**
 * A transaction whose ticket / invoice / quote tables all have exactly one row,
 * so a gate that fails closed is visible both as a zeroed count and as a table
 * that was never queried. Returns the list of queried tables.
 */
function buildPortalTrx(): string[] {
  const tablesQueried: string[] = [];
  withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
    callback(Object.assign((table: string) => {
      tablesQueried.push(table);
      if (table === 'contacts') {
        return chain([{ client_id: 'client-1', contact_name_id: 'contact-1' }]);
      }
      if (table === 'tickets') {
        return chain([{
          title: 'Hidden ticket',
          client_id: 'client-1',
          board_id: 'board-1',
          is_closed: false,
          timestamp: '2026-10-01T00:00:00Z',
          description: null,
        }]);
      }
      if (table === 'invoices' || table === 'invoices as inv') {
        return chain([{
          invoice_number: 'INV-HIDDEN',
          client_id: 'client-1',
          total: 1000,
          timestamp: '2026-10-01T00:00:00Z',
        }]);
      }
      if (table === 'quotes') {
        return chain([{
          quote_number: 'Q-HIDDEN',
          client_id: 'client-1',
          title: 'Quote',
          status: 'sent',
          timestamp: '2026-10-01T00:00:00Z',
        }]);
      }
      return chain([]);
    }, { raw: vi.fn() }))
  );

  getVisibilityContextMock.mockResolvedValue({
    contactId: 'contact-1',
    clientId: 'client-1',
    visibilityGroupId: 'group-1',
    visibleBoardIds: ['board-1'],
  });

  return tablesQueried;
}

it('service request activity never selects or surfaces the raw execution error text', async () => {
  vi.clearAllMocks();
  currentUser = { user_id: 'u', user_type: 'client', contact_id: 'contact-1', tenant: 'tenant-1' };
  createTenantKnexMock.mockResolvedValue({ knex: {} });
  hasPermissionMock.mockImplementation(async () => true);
  hasBillingReadPermissionMock.mockImplementation(async () => true);
  applyTicketVisibilityFilterMock.mockImplementation((query) => query);
  getVisibilityContextMock.mockResolvedValue({
    contactId: 'contact-1',
    clientId: 'client-1',
    visibilityGroupId: null,
    visibleBoardIds: [],
  });
  let serviceRequestQuery: any;
  withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
    callback(Object.assign((table: string) => {
      if (table === 'contacts') return chain([{ client_id: 'client-1', contact_name_id: 'contact-1' }]);
      if (table === 'service_request_submissions') {
        serviceRequestQuery = chain([
          {
            client_id: 'client-1',
            name: 'Access Request',
            status: 'failed',
            execution_error_summary: 'duplicate key value violates unique constraint "pk_tickets"',
            timestamp: '2026-10-01T00:00:00Z',
          },
        ]);
        return serviceRequestQuery;
      }
      return chain([]);
    }, { raw: vi.fn() }))
  );

  const { getRecentActivity } = await import('./dashboard');
  const activity = await getRecentActivity();

  const serviceRequestActivity = (activity as any[]).find((item) => item.type === 'service_request');
  expect(serviceRequestActivity).toMatchObject({ status: 'failed', description: '' });
  expect(JSON.stringify(activity)).not.toContain('duplicate key');
  expect(JSON.stringify(serviceRequestQuery.select.mock.calls)).not.toContain('execution_error_summary');
});

it.each([false, true])('dashboard count and activity exclude sibling/NULL tickets unless admin=%s', async (admin) => {
  vi.clearAllMocks();
  currentUser = { user_id: 'u', user_type: 'client', contact_id: 'contact-1', tenant: 'tenant-1' };
  createTenantKnexMock.mockResolvedValue({ knex: {} });
  hasPermissionMock.mockImplementation(async () => true);
  hasBillingReadPermissionMock.mockImplementation(async () => true);
  const { applyTicketVisibilityFilter } = await import('../../../../tickets/src/lib/clientPortalVisibility');
  applyTicketVisibilityFilterMock.mockImplementation(applyTicketVisibilityFilter as any);
  getVisibilityContextMock.mockResolvedValue({ ticketScope: 'contact', effectiveTicketScope: admin ? 'client' : 'contact', isClientAdmin: admin, contactId: 'contact-1', clientId: 'client-1', visibilityGroupId: 'g', visibleBoardIds: ['board-1'] });
  withTransactionMock.mockImplementation(async (_db, callback) => callback(Object.assign((table: string) => {
    if (table === 'contacts') return chain([{ client_id: 'client-1', contact_name_id: 'contact-1' }]);
    if (table === 'tickets') return chain([
      { title: 'Own', client_id: 'client-1', contact_name_id: 'contact-1', board_id: 'board-1', is_closed: false, timestamp: '2026-09-12T00:00:00Z' },
      { title: 'Sibling secret', client_id: 'client-1', contact_name_id: 'contact-2', board_id: 'board-1', is_closed: false, timestamp: '2026-09-12T00:00:00Z' },
      { title: 'Unassigned', client_id: 'client-1', contact_name_id: null, board_id: 'board-1', is_closed: false, timestamp: '2026-09-12T00:00:00Z' },
      { title: 'Other board', client_id: 'client-1', contact_name_id: 'contact-1', board_id: 'board-2', is_closed: false, timestamp: '2026-09-12T00:00:00Z' },
    ]);
    return chain([]);
  }, { raw: vi.fn() })));
  const { getDashboardMetrics, getRecentActivity } = await import('./dashboard');
  expect(await getDashboardMetrics()).toMatchObject({ openTickets: admin ? 3 : 1 });
  const activity = await getRecentActivity();
  expect(Array.isArray(activity)).toBe(true);
  expect(JSON.stringify(activity)).not.toContain('Other board');
  if (admin) expect(JSON.stringify(activity)).toContain('Sibling secret');
  else {
    expect(JSON.stringify(activity)).not.toContain('Sibling secret');
    expect(JSON.stringify(activity)).not.toContain('Unassigned');
  }
});

function chain(initial: any[]) {
  let rows = initial;
  let first = false;
  let count = false;
  const query: any = {};
  for (const key of ['select', 'leftJoin', 'join', 'whereNull', 'whereNotNull', 'orWhere', 'orderBy', 'limit', 'groupBy', 'andWhere']) query[key] = vi.fn(() => query);
  query.where = vi.fn((column: any, value: any) => {
    const conditions = typeof column === 'string' ? { [column]: value } : column;
    if (conditions && typeof conditions === 'object') rows = rows.filter((row) => Object.entries(conditions).every(([key, val]) => row[key.split('.').pop()!] === val));
    return query;
  });
  query.whereIn = vi.fn((column: string, values: any[]) => { rows = rows.filter((row) => values.includes(row[column.split('.').pop()!])); return query; });
  query.pluck = (column: string) => Promise.resolve(rows.map((row) => row[column.split('.').pop()!]));
  query.modify = (fn: any) => { fn(query); return query; };
  query.first = () => { first = true; return query; };
  query.count = () => { count = true; return query; };
  query.then = (resolve: any, reject: any) => Promise.resolve(count ? [{ count: rows.length }] : first ? rows[0] : rows).then(resolve, reject);
  return query;
}
