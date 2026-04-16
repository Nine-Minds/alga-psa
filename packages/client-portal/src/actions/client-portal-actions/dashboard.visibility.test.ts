import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const getVisibilityContextMock = vi.fn();
const applyVisibilityBoardFilterMock = vi.fn((query) => query);

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

vi.mock('@alga-psa/tickets/lib', () => ({
  applyVisibilityBoardFilter: (...args: any[]) => applyVisibilityBoardFilterMock(...args),
  getClientContactVisibilityContext: (...args: any[]) => getVisibilityContextMock(...args),
}));

describe('client portal dashboard visibility enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

        if (table === 'projects' || table === 'invoices' || table === 'assets') {
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

    expect(applyVisibilityBoardFilterMock).toHaveBeenCalledWith(
      ticketsQuery,
      ['board-1'],
      'tickets.board_id'
    );
    expect(metrics.openTickets).toBe(4);
  });
});
