import { describe, expect, it, vi, beforeEach } from 'vitest';

const withTransactionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const hasPermissionMock = vi.fn();
const deleteEntityTagsMock = vi.fn();
const publishEventMock = vi.fn();
const getBackendMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
}));

vi.mock('@alga-psa/db', () => ({
  withTransaction: withTransactionMock,
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({
  deleteEntityTags: deleteEntityTagsMock,
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: () => ({ publish: vi.fn() }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock('@alga-psa/sla/services', () => ({
  SlaBackendFactory: {
    getBackend: getBackendMock,
  },
}));

function createMockTrx(ticket: Record<string, any>) {
  return ((table: string) => {
    const chain: any = {
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(table === 'tickets' ? ticket : null),
      delete: vi.fn().mockResolvedValue(1),
    };
    return chain;
  }) as any;
}

describe('ticketActions deleteTicket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cancels SLA tracking when deleting a ticket', async () => {
    const backend = { cancelSla: vi.fn() };
    getBackendMock.mockResolvedValue(backend);
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    hasPermissionMock.mockResolvedValue(true);
    deleteEntityTagsMock.mockResolvedValue(undefined);
    publishEventMock.mockResolvedValue(undefined);

    const ticket = {
      ticket_id: 'ticket-1',
      tenant: 'tenant-1',
      closed_at: null,
      entered_at: new Date().toISOString(),
    };

    const trx = createMockTrx(ticket);
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<void>) => {
      await callback(trx);
    });

    const { deleteTicket } = await import('../ticketActions');

    await deleteTicket(
      {
        user_id: 'user-1',
        first_name: 'Test',
        last_name: 'User',
      } as any,
      { tenant: 'tenant-1' } as any,
      'ticket-1'
    );

    expect(backend.cancelSla).toHaveBeenCalledWith('ticket-1');
  });
});
