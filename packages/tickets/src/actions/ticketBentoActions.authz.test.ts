// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { user_id: 'internal-1', user_type: 'internal', tenant: 'tenant-1', roles: [{ role_id: 'role-1' }] } as any,
  deniedTicketIds: new Set<string>(),
  missingTicketIds: new Set<string>(),
  authorizationCalls: [] as Array<Record<string, unknown>>,
  coarsePermissionCalls: [] as unknown[][],
  tableReads: [] as string[],
  clientContractClientIds: [] as unknown[],
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(state.user, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (...args: unknown[]) => {
    state.coarsePermissionCalls.push(args);
    return true;
  }),
}));

vi.mock('@alga-psa/core', () => ({ workedMinutes: () => 0 }));

vi.mock('@alga-psa/db', () => {
  const makeQuery = (table: string) => {
    const query: any = {
      where: (criteria: Record<string, unknown>) => {
        if (table === 'client_contracts as cc') state.clientContractClientIds.push(criteria['cc.client_id']);
        return query;
      },
      andWhere: () => query,
      whereNotNull: () => query,
      orderBy: () => query,
      orderByRaw: () => query,
      groupBy: () => query,
      limit: () => query,
      select: () => query,
      join: () => query,
      first: async () => table === 'tickets'
        ? { ticket_id: 'ticket-1', client_id: 'authorized-client-for-ticket-1' }
        : undefined,
      then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve([]).then(resolve, reject),
    };
    return query;
  };

  return {
    createTenantKnex: async () => ({ knex: {} }),
    withTransaction: async (_knex: unknown, work: (trx: unknown) => unknown) => work({ raw: () => '' }),
    tenantDb: () => ({
      table: (table: string) => {
        state.tableReads.push(table);
        return makeQuery(table);
      },
      tenantJoin: (query: unknown) => query,
    }),
  };
});

vi.mock('../lib/ticketRecordAuthorization', () => ({
  authorizeTicketRecordAccess: vi.fn(async (input: Record<string, any>) => {
    state.authorizationCalls.push({
      tenant: input.tenant,
      ticketId: input.ticketId,
      action: input.action,
      userId: input.user.user_id,
    });
    if (state.missingTicketIds.has(input.ticketId)) throw new Error('Ticket not found');
    if (state.deniedTicketIds.has(input.ticketId)) throw new Error('Permission denied: Cannot access ticket');
    return {
      ticket_id: input.ticketId,
      client_id: `authorized-client-for-${input.ticketId}`,
      assigned_to: null,
      entered_by: null,
      board_id: 'board-authorized',
      assigned_team_id: null,
    };
  }),
}));

const actionArgs = ['ticket-1'];
const protectedTables = [
  'schedule_entries as se',
  'interactions as i',
  'time_entries',
  'client_contracts as cc',
  'appointment_requests as ar',
  'tickets as t',
];

async function actions() {
  return import('./ticketBentoActions');
}

async function outcome(read: (...args: any[]) => Promise<unknown>, ...args: any[]) {
  try {
    return await read(...args);
  } catch (error) {
    return { thrown: error instanceof Error ? error.message : String(error) };
  }
}

describe('ticket Bento record authorization', () => {
  beforeEach(() => {
    state.user = { user_id: 'internal-1', user_type: 'internal', tenant: 'tenant-1', roles: [{ role_id: 'role-1' }] };
    state.deniedTicketIds = new Set();
    state.missingTicketIds = new Set();
    state.authorizationCalls = [];
    state.coarsePermissionCalls = [];
    state.tableReads = [];
    state.clientContractClientIds = [];
  });

  it('requires bundle record authorization before any of the exported Bento reads fetches protected data', async () => {
    const bento = await actions();
    const reads = [
      bento.getTicketScheduleEntries,
      bento.getTicketInteractions,
      bento.getTicketBillingRollup,
      bento.getTicketAppointmentRequests,
      bento.getTicketSlaPolicyName,
    ];

    expect(reads).toHaveLength(5);
    for (const read of reads) {
      state.deniedTicketIds = new Set(['ticket-1']);
      state.authorizationCalls = [];
      state.coarsePermissionCalls = [];
      state.tableReads = [];
      const result = await outcome(read, actionArgs[0]);
      expect(result).toEqual({ thrown: 'Permission denied: Cannot access ticket' });
      expect(state.authorizationCalls).toEqual([
        { tenant: 'tenant-1', ticketId: 'ticket-1', action: 'read', userId: 'internal-1' },
      ]);
      expect(state.coarsePermissionCalls).toHaveLength(1);
      expect(state.coarsePermissionCalls[0].slice(1, 3)).toEqual(['ticket', 'read']);
      expect(state.tableReads.filter((table) => protectedTables.includes(table))).toEqual([]);
    }
  });

  it('returns the same action-boundary denial for a missing ticket and a ticket excluded by the bundle', async () => {
    const { getTicketScheduleEntries } = await actions();
    state.deniedTicketIds.add('excluded-ticket');
    state.missingTicketIds.add('missing-ticket');

    const excluded = await outcome(getTicketScheduleEntries, 'excluded-ticket');
    const missing = await outcome(getTicketScheduleEntries, 'missing-ticket');

    expect(excluded).toEqual({ thrown: 'Permission denied: Cannot access ticket' });
    expect(missing).toEqual(excluded);
    expect(state.tableReads.filter((table) => protectedTables.includes(table))).toEqual([]);
  });

  it('allows an authorized ticket and scopes contract lookup from the authorized ticket row', async () => {
    const { getTicketBillingRollup } = await actions();

    await expect(getTicketBillingRollup(actionArgs[0])).resolves.toEqual({
      totalMinutes: 0,
      billableMinutes: 0,
      entryCount: 0,
      uninvoicedBillableMinutes: 0,
      contractName: null,
    });
    expect(state.authorizationCalls[0]).toMatchObject({ ticketId: 'ticket-1', action: 'read' });
    expect(state.clientContractClientIds).toEqual(['authorized-client-for-ticket-1']);
  });

  it('every exported read succeeds for an authorized ticket', async () => {
    const bento = await actions();
    await expect(bento.getTicketScheduleEntries(actionArgs[0])).resolves.toEqual([]);
    await expect(bento.getTicketInteractions(actionArgs[0])).resolves.toEqual([]);
    await expect(bento.getTicketBillingRollup(actionArgs[0])).resolves.toMatchObject({ contractName: null });
    await expect(bento.getTicketAppointmentRequests(actionArgs[0])).resolves.toEqual([]);
    await expect(bento.getTicketSlaPolicyName(actionArgs[0])).resolves.toEqual({ policyName: null });
    expect(state.authorizationCalls).toHaveLength(5);
  });
});
