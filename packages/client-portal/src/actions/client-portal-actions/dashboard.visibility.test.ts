import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const getVisibilityContextMock = vi.fn();
const applyTicketVisibilityFilterMock = vi.fn((query) => query);

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
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
      { boardColumn: 'tickets.board_id', contactColumn: 'tickets.contact_name_id' }
    );
    expect(metrics.openTickets).toBe(4);
  });
});

it.each([false, true])('dashboard count and activity exclude sibling/NULL tickets unless admin=%s', async (admin) => {
  vi.clearAllMocks();
  currentUser = { user_id: 'u', user_type: 'client', contact_id: 'contact-1', tenant: 'tenant-1' };
  createTenantKnexMock.mockResolvedValue({ knex: {} });
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
  query.modify = (fn: any) => { fn(query); return query; };
  query.first = () => { first = true; return query; };
  query.count = () => { count = true; return query; };
  query.then = (resolve: any, reject: any) => Promise.resolve(count ? [{ count: rows.length }] : first ? rows[0] : rows).then(resolve, reject);
  return query;
}
