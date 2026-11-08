import { describe, expect, it, vi, beforeEach } from 'vitest';

const deleteEntityWithValidationMock = vi.hoisted(() => vi.fn());
const resolveBundleRulesMock = vi.hoisted(() => vi.fn(async () => [] as any[]));
const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));
const deleteTicketChildRecordsMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: (...args: unknown[]) => hasPermissionMock(...args) }));
vi.mock('@alga-psa/authorization/rbac', () => ({ hasPermission: (...args: unknown[]) => hasPermissionMock(...args) }));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: (...args: unknown[]) => resolveBundleRulesMock(...args),
}));
vi.mock('@alga-psa/authorization/portal/visibility.server', () => ({
  getClientContactVisibilityContext: vi.fn(async () => ({
    effectiveTicketScope: 'contact', ticketScope: 'contact', contactId: 'contact-1', clientId: 'client-1',
    visibleBoardIds: ['board-1'], isClientAdmin: false, visibilityGroupId: null,
  })),
}));
vi.mock('@alga-psa/tickets/lib/deleteTicketChildRecords', () => ({
  deleteTicketChildRecords: (...args: unknown[]) => deleteTicketChildRecordsMock(...args),
}));
vi.mock('@alga-psa/core/server', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, deleteEntityWithValidation: (...args: unknown[]) => deleteEntityWithValidationMock(...args) };
});

import { TicketService } from '../../../lib/api/services/TicketService';

function fakeKnex(initialTicket: Record<string, any> | null) {
  let ticket = initialTicket;
  const ticketDelete = vi.fn(async () => { ticket = null; return 1; });
  const knex: any = (table: string) => {
    const query: any = {
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      first: vi.fn(async () => table === 'tickets' ? ticket : undefined),
      delete: table === 'tickets' ? ticketDelete : vi.fn(async () => 1),
      then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
    };
    return query;
  };
  knex.getTicket = () => ticket;
  knex.ticketDelete = ticketDelete;
  return knex;
}

const ticketRow = () => ({
  ticket_id: 'retained-ticket-id', tenant: 'tenant-1', assigned_to: null, entered_by: 'owner-1',
  client_id: 'client-1', board_id: 'board-1', assigned_team_id: null, contact_name_id: 'contact-1',
  billing_profile_id: null, attributes: {},
});
const internalUser = { user_id: 'internal-1', user_type: 'internal', roles: [{ role_id: 'internal-role' }] };
const clientUser = {
  user_id: 'client-user', user_type: 'client', clientId: 'client-1', contact_id: 'contact-1',
  roles: [{ role_id: 'client-role' }],
};

describe('TicketService.delete authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveBundleRulesMock.mockResolvedValue([]);
    hasPermissionMock.mockResolvedValue(true);
    deleteEntityWithValidationMock.mockReset();
  });

  it('conceals missing and invisible client tickets before dependency validation', async () => {
    const service = new TicketService();
    const missingDb = fakeKnex(null);
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: missingDb });
    const missing = service.delete('retained-ticket-id', {
      tenant: 'tenant-1', userId: clientUser.user_id, user: clientUser,
    }).catch((error) => error.message);

    const invisibleDb = fakeKnex({ ...ticketRow(), contact_name_id: 'another-contact' });
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: invisibleDb });
    const invisible = service.delete('retained-ticket-id', {
      tenant: 'tenant-1', userId: clientUser.user_id, user: clientUser,
    }).catch((error) => error.message);

    await expect(Promise.all([missing, invisible])).resolves.toEqual(['Ticket not found', 'Ticket not found']);
    expect(deleteEntityWithValidationMock).not.toHaveBeenCalled();
    expect(missingDb.getTicket()).toBeNull();
    expect(invisibleDb.getTicket()).toMatchObject({ contact_name_id: 'another-contact' });
    expect(deleteTicketChildRecordsMock).not.toHaveBeenCalled();
  });

  it('blocks dependency validation and deletion when policy resolution fails', async () => {
    const service = new TicketService();
    const db = fakeKnex(ticketRow());
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db });
    resolveBundleRulesMock.mockRejectedValue(new Error('bundle policy database unavailable'));

    await expect(service.delete('retained-ticket-id', {
      tenant: 'tenant-1', userId: internalUser.user_id, user: internalUser,
    })).rejects.toThrow('bundle policy database unavailable');

    expect(deleteEntityWithValidationMock).not.toHaveBeenCalled();
    expect(deleteTicketChildRecordsMock).not.toHaveBeenCalled();
    expect(db.ticketDelete).not.toHaveBeenCalled();
    expect(db.getTicket()).toMatchObject({ ticket_id: 'retained-ticket-id' });
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it('rechecks record authorization in the transaction before child cleanup and ticket deletion', async () => {
    const service = new TicketService();
    const db = fakeKnex(ticketRow());
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db });
    resolveBundleRulesMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'board-scope', resource: 'ticket', action: 'update', templateKey: 'selected_boards', selectedBoardIds: ['board-2'] }]);
    deleteEntityWithValidationMock.mockImplementation(async (_type: string, _id: string, _knex: unknown, tenant: string, performDelete: (trx: unknown, tenant: string) => Promise<void>) => {
      await performDelete(db, tenant);
      return { deleted: true, canDelete: true, dependencies: [], alternatives: [] };
    });

    await expect(service.delete('retained-ticket-id', {
      tenant: 'tenant-1', userId: internalUser.user_id, user: internalUser,
    })).rejects.toThrow('Permission denied: Cannot delete ticket');

    expect(deleteTicketChildRecordsMock).not.toHaveBeenCalled();
    expect(db.ticketDelete).not.toHaveBeenCalled();
    expect(db.getTicket()).toMatchObject({ ticket_id: 'retained-ticket-id' });
  });

  it('deletes an authorized ticket after child cleanup', async () => {
    const service = new TicketService();
    const db = fakeKnex(ticketRow());
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db });
    deleteEntityWithValidationMock.mockImplementation(async (_type: string, _id: string, _knex: unknown, tenant: string, performDelete: (trx: unknown, tenant: string) => Promise<void>) => {
      await performDelete(db, tenant);
      return { deleted: true, canDelete: true, dependencies: [], alternatives: [] };
    });

    await service.delete('retained-ticket-id', {
      tenant: 'tenant-1', userId: internalUser.user_id, user: internalUser,
    });

    expect(deleteTicketChildRecordsMock).toHaveBeenCalledTimes(1);
    expect(db.ticketDelete).toHaveBeenCalledTimes(1);
    expect(db.getTicket()).toBeNull();
  });
});
