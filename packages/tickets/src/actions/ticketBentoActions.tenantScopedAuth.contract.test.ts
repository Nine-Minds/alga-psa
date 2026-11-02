// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  tenant: 'tenant-1',
  user: { user_id: 'internal-1', user_type: 'internal', roles: [{ role_id: 'role-1' }] } as any,
  coarsePermission: true,
  permissionCalls: [] as unknown[][],
  authorizationCalls: [] as Array<Record<string, unknown>>,
  tableScopes: [] as Array<{ tenant: string; table: string }>,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(state.user, { tenant: state.tenant }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (...args: unknown[]) => {
    state.permissionCalls.push(args);
    return state.coarsePermission;
  }),
}));

vi.mock('@alga-psa/core', () => ({ workedMinutes: () => 0 }));

vi.mock('@alga-psa/db', () => {
  const makeQuery = () => {
    const query: any = {
      where: () => query,
      andWhere: () => query,
      whereNotNull: () => query,
      orderBy: () => query,
      orderByRaw: () => query,
      groupBy: () => query,
      limit: () => query,
      select: () => query,
      join: () => query,
      first: async () => undefined,
      then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve([]).then(resolve, reject),
    };
    return query;
  };

  return {
    createTenantKnex: async () => ({ knex: {} }),
    withTransaction: async (_knex: unknown, work: (trx: unknown) => unknown) => work({ raw: () => '' }),
    tenantDb: (_conn: unknown, tenant: string) => ({
      table: (table: string) => {
        state.tableScopes.push({ tenant, table });
        return makeQuery();
      },
      tenantJoin: (query: unknown) => query,
    }),
  };
});

vi.mock('../lib/ticketRecordAuthorization', () => ({
  authorizeTicketRecordAccess: vi.fn(async (input: Record<string, any>) => {
    state.authorizationCalls.push({ tenant: input.tenant, ticketId: input.ticketId, action: input.action });
    return {
      ticket_id: input.ticketId,
      client_id: 'client-1',
      assigned_to: null,
      entered_by: null,
      board_id: 'board-1',
      assigned_team_id: null,
    };
  }),
}));

async function actions() {
  return import('./ticketBentoActions');
}

async function outcome(action: (...args: any[]) => Promise<unknown>) {
  try {
    return await action('ticket-1');
  } catch (error) {
    return { thrown: error instanceof Error ? error.message : String(error) };
  }
}

describe('ticket Bento action access boundaries', () => {
  beforeEach(() => {
    state.tenant = 'tenant-1';
    state.user = { user_id: 'internal-1', user_type: 'internal', roles: [{ role_id: 'role-1' }] };
    state.coarsePermission = true;
    state.permissionCalls = [];
    state.authorizationCalls = [];
    state.tableScopes = [];
  });

  it('scopes every Bento read and record-authorization lookup to the authenticated tenant', async () => {
    state.tenant = 'tenant-2';
    const bento = await actions();
    const reads = [
      bento.getTicketScheduleEntries,
      bento.getTicketInteractions,
      bento.getTicketBillingRollup,
      bento.getTicketAppointmentRequests,
      bento.getTicketSlaPolicyName,
    ];

    for (const read of reads) {
      const result = await outcome(read);
      expect(result).not.toHaveProperty('permissionError');
      expect(result).not.toHaveProperty('thrown');
    }

    expect(state.permissionCalls).toHaveLength(reads.length);
    expect(state.permissionCalls.every((call) => call[1] === 'ticket' && call[2] === 'read')).toBe(true);
    expect(state.authorizationCalls).toEqual(reads.map(() => ({
      tenant: 'tenant-2', ticketId: 'ticket-1', action: 'read',
    })));
    expect(state.tableScopes.length).toBeGreaterThan(0);
    expect(state.tableScopes.every(({ tenant }) => tenant === 'tenant-2')).toBe(true);
  });

  it('keeps Bento data internal-only', async () => {
    state.user = { ...state.user, user_type: 'client' };
    const { getTicketScheduleEntries } = await actions();

    expect(await outcome(getTicketScheduleEntries)).toEqual({
      permissionError: 'Permission denied: ticket bento data is internal-only in v1',
    });
    expect(state.permissionCalls).toEqual([]);
    expect(state.authorizationCalls).toEqual([]);
    expect(state.tableScopes).toEqual([]);
  });

  it('requires coarse ticket:read before record authorization or protected queries', async () => {
    state.coarsePermission = false;
    const { getTicketScheduleEntries } = await actions();

    expect(await outcome(getTicketScheduleEntries)).toEqual({
      thrown: 'Permission denied: cannot read ticket',
    });
    expect(state.permissionCalls).toHaveLength(1);
    expect(state.permissionCalls[0].slice(1, 3)).toEqual(['ticket', 'read']);
    expect(state.authorizationCalls).toEqual([]);
    expect(state.tableScopes).toEqual([]);
  });
});
