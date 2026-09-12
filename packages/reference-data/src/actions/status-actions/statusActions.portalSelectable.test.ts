import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;
let statusRows: Array<Record<string, unknown>> = [];

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (table: string) => conn(table),
  }),
}));

vi.mock('@alga-psa/core/server', () => ({
  deleteEntityWithValidation: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  actionError: (message: string, key?: string) => ({ actionError: message, messageKey: key }),
}));

function createStatusesTrx() {
  const filters: Array<Record<string, unknown>> = [];

  const makeBuilder = (): any => {
    const builder: any = {
      where: vi.fn((clause: Record<string, unknown>) => {
        filters.push(clause);
        return builder;
      }),
      andWhere: vi.fn((clause: Record<string, unknown>) => {
        filters.push(clause);
        return builder;
      }),
      whereNotNull: vi.fn(() => builder),
      modify: vi.fn((callback: (builder: any) => void) => {
        callback(builder);
        return builder;
      }),
      select: vi.fn(() => builder),
      orderBy: vi.fn(() => builder),
      then: (resolve: any, reject: any) => {
        const rows = statusRows.filter((row) =>
          filters.every((clause) => Object.entries(clause).every(([key, value]) => row[key] === value))
        );
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return builder;
  };

  return ((table: string) => {
    if (table === 'statuses') {
      return makeBuilder();
    }
    throw new Error(`Unexpected table: ${table}`);
  }) as any;
}

describe('shared status reads remain portal-unaware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { user_id: 'internal-user-1', user_type: 'internal', tenant: 'tenant-1' };
    statusRows = [
      {
        status_id: 's-open',
        board_id: 'board-1',
        status_type: 'ticket',
        portal_selectable: true,
        order_number: 10,
        name: 'Open',
      },
      {
        status_id: 's-vendor',
        board_id: 'board-1',
        status_type: 'ticket',
        portal_selectable: false,
        order_number: 20,
        name: 'Waiting on Vendor',
      },
    ];

    const trx = createStatusesTrx();
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    withTransactionMock.mockImplementation(async (_db: unknown, callback: (trx: unknown) => Promise<unknown>) =>
      callback(trx)
    );
  });

  it('T005: getTicketStatuses returns both selectable and non-selectable statuses', async () => {
    const { getTicketStatuses } = await import('./statusActions');

    const result = (await getTicketStatuses('board-1')) as Array<{ status_id: string; portal_selectable: boolean }>;

    expect(result.map((status) => status.status_id).sort()).toEqual(['s-open', 's-vendor']);
    expect(result.find((status) => status.status_id === 's-vendor')?.portal_selectable).toBe(false);
  });
});
