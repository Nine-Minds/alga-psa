// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getScheduledHoursForTicket, getTicketAppointmentRequests } from './ticketActions';

const state = vi.hoisted(() => ({
  tenant: 'tenant-1',
  user: { user_id: 'internal-1', user_type: 'internal', roles: [{ role_id: 'role-1' }] } as any,
  missing: new Set<string>(),
  excluded: new Set<string>(),
  coarsePermissionCalls: [] as unknown[][],
  authorizationCalls: [] as Array<Record<string, unknown>>,
  tableReads: [] as Array<{ tenant: string; table: string }>,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(state.user, { tenant: state.tenant }, ...args),
  localizeActionError: async (result: unknown) => result,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (...args: unknown[]) => {
    state.coarsePermissionCalls.push(args);
    return true;
  }),
}));

vi.mock('@alga-psa/db', () => {
  const makeQuery = () => {
    const query: any = {
      where: () => query,
      orderBy: () => query,
      select: () => query,
      then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve([]).then(resolve, reject),
    };
    return query;
  };

  return {
    createTenantKnex: async () => ({ knex: {} }),
    withTransaction: async (_knex: unknown, work: (trx: unknown) => unknown) => work({}),
    tenantDb: (_conn: unknown, tenant: string) => ({
      table: (table: string) => {
        state.tableReads.push({ tenant, table });
        return makeQuery();
      },
      tenantJoin: (query: unknown) => query,
    }),
  };
});

vi.mock('../lib/ticketRecordAuthorization', () => ({
  authorizeTicketRecordAccess: vi.fn(async (input: Record<string, any>) => {
    state.authorizationCalls.push({ tenant: input.tenant, ticketId: input.ticketId, action: input.action });
    if (state.missing.has(input.ticketId)) throw new Error('Ticket not found');
    if (state.excluded.has(input.ticketId)) throw new Error('Permission denied: Cannot access ticket');
    return {
      ticket_id: input.ticketId,
      client_id: 'authorized-client',
      assigned_to: null,
      entered_by: null,
      board_id: 'board-1',
      assigned_team_id: null,
    };
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../models/ticket', () => ({ default: class Ticket {} }));
vi.mock('@alga-psa/auth/actions/policyActions', () => ({ getTicketAttributes: vi.fn() }));
vi.mock('@alga-psa/tags/actions/tagActions', () => ({ createTagsForEntityWithTransaction: vi.fn(), findTagsByEntityIds: vi.fn() }));
vi.mock('@alga-psa/tags/models/tagMapping', () => ({ default: class TagMapping {} }));
vi.mock('@alga-psa/tags/actions/tagActionErrors', () => ({ isTagActionError: () => false }));
vi.mock('./teamAssignmentActions', () => ({ assignTeamToTicket: vi.fn(), removeTeamFromTicket: vi.fn() }));
vi.mock('@alga-psa/validation', () => ({ validateData: (_schema: unknown, value: unknown) => value }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(), publishStoredWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/event-bus/events', () => ({ TicketCreatedEvent: class {}, TicketUpdatedEvent: class {}, TicketClosedEvent: class {}, TicketResponseStateChangedEvent: class {} }));
vi.mock('@alga-psa/shared/models/ticketModel', () => ({ TicketModel: {} }));
vi.mock('@alga-psa/shared/services/tickets/ticketModelEventPublisher', () => ({ TicketModelEventPublisher: class {} }));
vi.mock('../lib/adapters/TicketModelAnalyticsTracker', () => ({ TicketModelAnalyticsTracker: class {} }));
vi.mock('@alga-psa/tickets/lib/itilUtils', () => ({ calculateItilPriority: vi.fn() }));
vi.mock('../lib/clientPortalVisibility.server', () => ({ getClientContactVisibilityContext: vi.fn() }));
vi.mock('@alga-psa/shared/services/tickets/ticketSlaStageEvents', () => ({
  buildTicketResolutionSlaStageCompletionEvent: vi.fn(),
  buildTicketResolutionSlaStageEnteredEvent: vi.fn(),
  publishWorkflowTicketSlaStageEvent: vi.fn(),
}));
vi.mock('./optimizedTicketActions', () => ({ addTicketCommentInTransaction: vi.fn(), updateTicketWithCache: vi.fn(), updateTicketInTransaction: vi.fn() }));

const actionTables = ['schedule_entries as se', 'appointment_requests as ar'];
const permissionMessage = (result: any) => result?.permissionError ?? result?.error;

describe('ticket sibling reads enforce record authorization', () => {
  beforeEach(() => {
    state.tenant = 'tenant-1';
    state.missing = new Set();
    state.excluded = new Set();
    state.coarsePermissionCalls = [];
    state.authorizationCalls = [];
    state.tableReads = [];
  });

  const reads = [getScheduledHoursForTicket, getTicketAppointmentRequests];

  it('requires record authorization before protected queries even when coarse ticket:read is granted', async () => {
    state.excluded = new Set(['ticket-1']);
    for (const read of reads) {
      state.tableReads = [];
      const result = await read('ticket-1');
      expect(permissionMessage(result)).toBe('Permission denied: Cannot access ticket');
      expect(state.coarsePermissionCalls.at(-1)?.slice(1, 3)).toEqual(['ticket', 'read']);
      expect(state.authorizationCalls.at(-1)).toEqual({ tenant: 'tenant-1', ticketId: 'ticket-1', action: 'read' });
      expect(state.tableReads.filter(({ table }) => actionTables.includes(table))).toEqual([]);
    }
  });

  it('returns indistinguishable mapped errors for missing and bundle-excluded tickets', async () => {
    state.missing = new Set(['missing-ticket']);
    state.excluded = new Set(['excluded-ticket']);
    for (const read of reads) {
      const missing = await read('missing-ticket');
      const excluded = await read('excluded-ticket');
      expect(missing).toEqual(excluded);
      expect(permissionMessage(missing)).toBe('Permission denied: Cannot access ticket');
    }
  });

  it('returns appointment and schedule data for included tickets with tenant scoping', async () => {
    state.tenant = 'tenant-2';
    for (const read of reads) {
      state.tableReads = [];
      const result = await read('included-ticket');
      if (read === getTicketAppointmentRequests) expect(result).toEqual({ success: true, data: [] });
      else expect(result).toEqual([]);
      expect(state.tableReads.filter(({ table }) => actionTables.includes(table))).toHaveLength(1);
      expect(state.tableReads.every(({ tenant }) => tenant === 'tenant-2')).toBe(true);
      expect(state.authorizationCalls.at(-1)).toMatchObject({ tenant: 'tenant-2', ticketId: 'included-ticket', action: 'read' });
    }
  });
});
