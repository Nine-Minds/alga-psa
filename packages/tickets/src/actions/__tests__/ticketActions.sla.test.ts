import { describe, expect, it, vi, beforeEach } from 'vitest';

// Static import keeps the (expensive) ticketActions module evaluation in the
// collection phase instead of counting against the 5s test timeout. vi.mock
// factories below are hoisted above this import by vitest.
import { deleteTicket, registerSlaCancellation } from '../ticketActions';

const {
  withTransactionMock,
  createTenantKnexMock,
  hasPermissionMock,
  deleteEntityTagsMock,
  publishEventMock,
  getBackendMock,
  revalidatePathMock,
  deleteEntityWithValidationMock,
} = vi.hoisted(() => ({
  withTransactionMock: vi.fn(),
  createTenantKnexMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  deleteEntityTagsMock: vi.fn(),
  publishEventMock: vi.fn(),
  getBackendMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  deleteEntityWithValidationMock: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
  withOptionalAuth: (fn: any) => fn,
  hasPermission: vi.fn(async () => true),
  getCurrentUser: vi.fn(async () => null),
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

// deleteTicket now routes through deleteEntityWithValidation (@alga-psa/core)
// instead of a bare withTransaction; stub just that export and keep the rest.
vi.mock('@alga-psa/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    deleteEntityWithValidation: (...args: unknown[]) => deleteEntityWithValidationMock(...args),
  };
});

function createMockTrx(ticket: Record<string, any>) {
  const trx: any = (table: string) => {
    const chain: any = {
      where: vi.fn().mockReturnThis(),
      whereIn: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(table === 'tickets' ? ticket : null),
      pluck: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(1),
      delete: vi.fn().mockResolvedValue(1),
    };
    return chain;
  };
  trx.raw = vi.fn((sql: string) => sql);
  return trx as any;
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
    deleteEntityWithValidationMock.mockImplementation(
      async (
        _entityType: string,
        _entityId: string,
        _knex: any,
        tenantId: string,
        performDelete: (trx: any, tenant: string) => Promise<void>
      ) => {
        await performDelete(trx, tenantId);
        return { canDelete: true, deleted: true, dependencies: [], alternatives: [] };
      }
    );

    // SLA cancellation is injected by the composition layer in production
    // (see packages/msp-composition/src/tickets/registerSlaIntegration.ts);
    // mirror that wiring here against the mocked SlaBackendFactory.
    await registerSlaCancellation(async (tenantId: string, ticketId: string) => {
      const slaBackend = await getBackendMock();
      await slaBackend.cancelSla(tenantId, ticketId);
    });

    await (deleteTicket as any)(
      {
        user_id: 'user-1',
        first_name: 'Test',
        last_name: 'User',
      } as any,
      { tenant: 'tenant-1' } as any,
      'ticket-1'
    );

    expect(backend.cancelSla).toHaveBeenCalledWith('tenant-1', 'ticket-1');
  });
});
