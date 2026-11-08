import { describe, expect, it, vi, beforeEach } from 'vitest';

// Static import keeps the (expensive) ticketActions module evaluation in the
// collection phase instead of counting against the 5s test timeout. vi.mock
// factories below are hoisted above this import by vitest.
import { deleteTicket, deleteTickets, registerSlaCancellation } from '../ticketActions';

const {
  withTransactionMock,
  createTenantKnexMock,
  hasPermissionMock,
  deleteEntityTagsMock,
  publishEventMock,
  getBackendMock,
  revalidatePathMock,
  deleteEntityWithValidationMock,
  resolveBundleRulesMock,
  deleteTicketChildRecordsMock,
  getClientContactVisibilityContextMock,
} = vi.hoisted(() => ({
  withTransactionMock: vi.fn(),
  createTenantKnexMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  deleteEntityTagsMock: vi.fn(),
  publishEventMock: vi.fn(),
  getBackendMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  deleteEntityWithValidationMock: vi.fn(),
  resolveBundleRulesMock: vi.fn(async (..._args: any[]): Promise<any[]> => []),
  deleteTicketChildRecordsMock: vi.fn(),
  getClientContactVisibilityContextMock: vi.fn<typeof import('@alga-psa/authorization/portal/visibility.server').getClientContactVisibilityContext>(async () => ({
    effectiveTicketScope: 'contact', ticketScope: 'contact', contactId: 'contact-1', clientId: 'client-1',
    visibleBoardIds: ['board-1'], isClientAdmin: false, visibilityGroupId: null,
  })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
  withOptionalAuth: (fn: any) => fn,
  hasPermission: vi.fn(async () => true),
  getCurrentUser: vi.fn(async () => null),
  localizeActionError: vi.fn(async () => ({ actionError: 'Ticket could not be deleted' })),
}));

vi.mock('@alga-psa/db', () => ({
  withTransaction: withTransactionMock,
  createTenantKnex: createTenantKnexMock,
  tenantDb: (conn: any, _tenant: string) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
  }),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/authorization/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({
  deleteEntityTags: deleteEntityTagsMock,
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: (...args: unknown[]) => resolveBundleRulesMock(...args),
}));

vi.mock('@alga-psa/authorization/portal/visibility.server', () => ({
  getClientContactVisibilityContext: getClientContactVisibilityContextMock,
}));

vi.mock('../../lib/deleteTicketChildRecords', () => ({
  deleteTicketChildRecords: (...args: unknown[]) => deleteTicketChildRecordsMock(...args),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: vi.fn(),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
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

// deleteTicket now routes through deleteEntityWithValidation, imported from
// @alga-psa/core/server (the facade migration moved it off the bare entry);
// stub just that export and keep the rest.
vi.mock('@alga-psa/core/server', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    deleteEntityWithValidation: (...args: unknown[]) => deleteEntityWithValidationMock(...args),
  };
});

function makeTicket(overrides: Record<string, unknown> = {}) {
  return {
    ticket_id: 'ticket-1',
    tenant: 'tenant-1',
    assigned_to: null,
    entered_by: 'owner',
    client_id: 'client-1',
    board_id: 'board-1',
    assigned_team_id: null,
    contact_name_id: 'contact-1',
    billing_profile_id: null,
    attributes: {},
    closed_at: null,
    entered_at: new Date().toISOString(),
    ...overrides,
  };
}

function createMockTrx(ticket: Record<string, any> | null) {
  let currentTicket: Record<string, any> | null = ticket;
  const ticketDeleteMock = vi.fn(async () => { currentTicket = null; return 1; });
  const trx: any = (table: string) => {
    const chain: any = {
      where: vi.fn().mockReturnThis(),
      whereIn: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      first: vi.fn(async () => table === 'tickets' ? currentTicket : null),
      pluck: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(1),
      delete: table === 'tickets' ? ticketDeleteMock : vi.fn().mockResolvedValue(1),
      then: (resolve: (value: unknown[]) => unknown) => resolve([]),
    };
    return chain;
  };
  trx.raw = vi.fn((sql: string) => sql);
  trx.ticketDeleteMock = ticketDeleteMock;
  trx.getTicket = () => currentTicket;
  return trx as any;
}

describe('ticketActions deleteTicket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveBundleRulesMock.mockReset().mockResolvedValue([]);
    hasPermissionMock.mockReset().mockResolvedValue(true);
    deleteEntityWithValidationMock.mockReset();
    deleteTicketChildRecordsMock.mockResolvedValue(undefined);
    getClientContactVisibilityContextMock.mockReset().mockResolvedValue({
      effectiveTicketScope: 'contact', ticketScope: 'contact', contactId: 'contact-1', clientId: 'client-1',
      visibleBoardIds: ['board-1'], isClientAdmin: false, visibilityGroupId: null,
    });
  });

  it('cancels SLA tracking when deleting a ticket', async () => {
    const backend = { cancelSla: vi.fn() };
    getBackendMock.mockResolvedValue(backend);
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    hasPermissionMock.mockResolvedValue(true);
    deleteEntityTagsMock.mockResolvedValue(undefined);
    publishEventMock.mockResolvedValue(undefined);

    const ticket = makeTicket({ entered_by: 'user-1' });

    const trx = createMockTrx(ticket);
    createTenantKnexMock.mockResolvedValue({ knex: trx });
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

    const result = await (deleteTicket as any)(
      {
        user_id: 'user-1',
        user_type: 'internal',
        roles: [{ role_id: 'r1' }],
        first_name: 'Test',
        last_name: 'User',
      } as any,
      { tenant: 'tenant-1' } as any,
      'ticket-1'
    );

    expect(result).toMatchObject({ success: true, deleted: true });
    expect(backend.cancelSla).toHaveBeenCalledWith('tenant-1', 'ticket-1');
    expect(publishEventMock).toHaveBeenCalledTimes(1);
    expect(publishEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'TICKET_DELETED',
      payload: expect.objectContaining({ tenantId: 'tenant-1', ticketId: 'ticket-1' }),
    }));
    expect(deleteTicketChildRecordsMock).toHaveBeenCalledTimes(1);
    expect(trx.getTicket()).toBeNull();
  });

  it('denies restricted internal single and bulk deletes before dependency validation', async () => {
    const ticket = makeTicket();
    const trx = createMockTrx(ticket);
    createTenantKnexMock.mockResolvedValue({ knex: trx });
    resolveBundleRulesMock.mockResolvedValue([
      { id: 'board-scope', resource: 'ticket', action: 'update', templateKey: 'selected_boards', selectedBoardIds: ['board-2'] },
    ]);

    const single = await (deleteTicket as any)(
      { user_id: 'user-1', user_type: 'internal', roles: [{ role_id: 'r1' }] }, { tenant: 'tenant-1' }, 'ticket-1'
    );
    const bulk = await (deleteTickets as any)(
      { user_id: 'user-1', user_type: 'internal', roles: [{ role_id: 'r1' }] }, { tenant: 'tenant-1' }, ['ticket-1']
    );

    expect(single.success).toBe(false);
    expect(single.dependencies).toEqual([]);
    expect(bulk.deletedIds).toEqual([]);
    expect(bulk.failed).toHaveLength(1);
    expect(deleteEntityWithValidationMock).not.toHaveBeenCalled();
    expect(deleteTicketChildRecordsMock).not.toHaveBeenCalled();
    expect(publishEventMock).not.toHaveBeenCalled();
    expect(trx.ticketDeleteMock).not.toHaveBeenCalled();
    expect(trx.getTicket()).toEqual(ticket);
  });

  it('rechecks authorization inside the deletion transaction before deleting child rows', async () => {
    const ticket = makeTicket();
    const trx = createMockTrx(ticket);
    createTenantKnexMock.mockResolvedValue({ knex: trx });
    resolveBundleRulesMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'board-scope', resource: 'ticket', action: 'update', templateKey: 'selected_boards', selectedBoardIds: ['board-2'] }]);
    deleteEntityWithValidationMock.mockImplementation(
      async (_type: string, _id: string, _knex: any, tenant: string, performDelete: (trx: any, tenant: string) => Promise<void>) => {
        await performDelete(trx, tenant);
        return { canDelete: true, deleted: true, dependencies: [], alternatives: [] };
      }
    );

    const result = await (deleteTicket as any)(
      { user_id: 'user-1', user_type: 'internal', roles: [{ role_id: 'r1' }] }, { tenant: 'tenant-1' }, 'ticket-1'
    );

    expect(result.success).toBe(false);
    expect(result.dependencies).toEqual([]);
    expect(deleteTicketChildRecordsMock).not.toHaveBeenCalled();
    expect(trx.ticketDeleteMock).not.toHaveBeenCalled();
    expect(trx.getTicket()).toEqual(ticket);
    expect(publishEventMock).not.toHaveBeenCalled();
  });

  it('does not validate dependencies or delete when bundle policy resolution fails', async () => {
    const ticket = makeTicket();
    const trx = createMockTrx(ticket);
    createTenantKnexMock.mockResolvedValue({ knex: trx });
    resolveBundleRulesMock.mockRejectedValue(new Error('policy resolution failed'));
    hasPermissionMock.mockResolvedValue(true);

    const result = await (deleteTicket as any)(
      { user_id: 'user-1', user_type: 'internal', roles: [{ role_id: 'r1' }] }, { tenant: 'tenant-1' }, 'ticket-1'
    );

    expect(result.success).toBe(false);
    expect(result.dependencies).toEqual([]);
    expect(deleteEntityWithValidationMock).not.toHaveBeenCalled();
    expect(deleteTicketChildRecordsMock).not.toHaveBeenCalled();
    expect(trx.ticketDeleteMock).not.toHaveBeenCalled();
    expect(trx.getTicket()).toEqual(ticket);
    expect(publishEventMock).not.toHaveBeenCalled();
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it('conceals missing and invisible client tickets without exposing dependencies', async () => {
    const missingTrx = createMockTrx(null);
    const invisibleTicket = makeTicket({ contact_name_id: 'another-contact' });
    const invisibleTrx = createMockTrx(invisibleTicket);
    createTenantKnexMock
      .mockResolvedValueOnce({ knex: missingTrx })
      .mockResolvedValueOnce({ knex: invisibleTrx });
    const client = { user_id: 'client-1', user_type: 'client', clientId: 'client-1', contact_id: 'contact-1', roles: [{ role_id: 'r1' }] };

    const missing = await (deleteTicket as any)(client, { tenant: 'tenant-1' }, 'ticket-1');
    const invisible = await (deleteTicket as any)(client, { tenant: 'tenant-1' }, 'ticket-1');

    expect(missing.message).toBe(invisible.message);
    expect(missing.dependencies).toEqual([]);
    expect(invisible.dependencies).toEqual([]);
    expect(deleteEntityWithValidationMock).not.toHaveBeenCalled();
    expect(deleteTicketChildRecordsMock).not.toHaveBeenCalled();
    expect(missingTrx.ticketDeleteMock).not.toHaveBeenCalled();
    expect(invisibleTrx.ticketDeleteMock).not.toHaveBeenCalled();
    expect(invisibleTrx.getTicket()).toMatchObject({ contact_name_id: 'another-contact' });
    expect(getClientContactVisibilityContextMock).toHaveBeenCalledTimes(1);
    expect(getClientContactVisibilityContextMock).toHaveBeenCalledWith(invisibleTrx, 'tenant-1', 'contact-1');
  });

  it('allows an authorized client ticket to reach deletion dependency validation', async () => {
    const trx = createMockTrx(makeTicket());
    createTenantKnexMock.mockResolvedValue({ knex: trx });
    const dependencyBlock = {
      canDelete: false,
      code: 'DEPENDENCIES_EXIST',
      message: '1 time entry blocks deletion',
      dependencies: [{ type: 'time_entry', count: 1 }],
      alternatives: [{ action: 'archive' }],
    };
    deleteEntityWithValidationMock.mockResolvedValue(dependencyBlock);
    const client = {
      user_id: 'client-1', user_type: 'client', clientId: 'client-1', contact_id: 'contact-1',
      roles: [{ role_id: 'r1' }],
    };

    const result = await (deleteTicket as any)(client, { tenant: 'tenant-1' }, 'ticket-1');

    expect(result).toMatchObject({ ...dependencyBlock, success: false });
    expect(getClientContactVisibilityContextMock).toHaveBeenCalledTimes(1);
    expect(deleteEntityWithValidationMock).toHaveBeenCalledTimes(1);
    expect(trx.ticketDeleteMock).not.toHaveBeenCalled();
  });
});
