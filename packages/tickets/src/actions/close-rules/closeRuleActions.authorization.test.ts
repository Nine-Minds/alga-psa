import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { user_id: 'user-1', user_type: 'client' as string },
  permissions: new Set<string>(),
  permissionCalls: [] as Array<[string, string, string | undefined]>,
  queries: [] as Array<{ conn: string; table: string; op: string }>,
  transactionCalls: [] as string[],
  authorizedTicket: null as any,
  authorizationError: null as Error | null,
  closureFailures: [] as any[],
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(state.user, { tenant: 'tenant-1' }, ...args),
  hasPermission: async (user: any, resource: string, action: string, conn?: any) => {
    state.permissionCalls.push([resource, action, conn?.label]);
    return state.permissions.has(`${resource}:${action}`);
  },
}));

vi.mock('@alga-psa/types', () => ({
  isMspPrincipalUserType: (userType: string) => userType === 'internal',
}));

vi.mock('../../lib/ticketRecordAuthorization', () => ({
  authorizeTicketRecordAccessConcealed: vi.fn(async (input: any) => {
    state.queries.push({ conn: input.trx.label, table: 'authorize-ticket', op: 'read' });
    if (state.authorizationError) throw state.authorizationError;
    return state.authorizedTicket;
  }),
}));

vi.mock('../../lib/validateTicketClosure', () => ({
  CLOSE_RULE_REQUIRED_FIELDS: ['category', 'subcategory', 'priority', 'assignee'],
  evaluateTicketCloseRules: vi.fn(async (conn: any) => {
    state.queries.push({ conn: conn.label, table: 'close-rule-evaluation', op: 'read' });
    return state.closureFailures;
  }),
}));

vi.mock('@alga-psa/db', () => {
  const getValue = (table: string, where: Record<string, unknown>) => {
    if (table === 'boards') return { board_id: where.board_id };
    if (table === 'statuses') {
      return where.status_id === 'closed' ? { status_id: 'closed', is_closed: true } : { status_id: 'open', is_closed: false };
    }
    if (table === 'board_auto_close_rules' && !where.rule_id) return null;
    if (table === 'board_auto_close_rules') return {
      rule_id: where.rule_id ?? 'rule-1',
      board_id: 'board-1',
      trigger_status_id: 'open',
      inactivity_days: 4,
      warning_days_before: null,
      close_to_status_id: 'closed',
      is_enabled: true,
      suppress_contact_notifications: false,
      suppress_internal_notifications: false,
    };
    if (table === 'tickets') return state.authorizedTicket;
    if (table === 'board_close_rules') return null;
    return null;
  };

  const makeQuery = (conn: any, table: string): any => {
    let where: Record<string, unknown> = {};
    const record = (op: string) => state.queries.push({ conn: conn.label, table, op });
    const builder: any = {
      where: (clause: Record<string, unknown>) => { where = clause; return builder; },
      whereNot: () => builder,
      modify: (fn: (query: any) => void) => { fn(builder); return builder; },
      first: async () => { record('first'); return getValue(table, where); },
      orderBy: () => builder,
      select: async () => { record('select'); return []; },
      insert: () => ({
        onConflict: () => ({ merge: () => ({ returning: async () => [{ board_id: 'board-1', required_fields: '[]', is_enabled: true }] }) }),
        returning: async () => [{ rule_id: 'rule-1', board_id: 'board-1', trigger_status_id: 'open', inactivity_days: 4, close_to_status_id: 'closed', is_enabled: true, suppress_contact_notifications: false, suppress_internal_notifications: false }],
      }),
      update: () => ({ returning: async () => [getValue(table, where)] }),
      del: async () => { record('del'); return 1; },
    };
    return builder;
  };
  const base = { label: 'base' };
  const trx = { label: 'trx', fn: { now: () => 'now' } };
  return {
    createTenantKnex: async () => ({ knex: base }),
    withTransaction: async (_db: any, work: any) => {
      state.transactionCalls.push('trx');
      return work(trx);
    },
    tenantDb: (conn: any) => ({ table: (table: string) => makeQuery(conn, table) }),
  };
});

const loadActions = () => import('./closeRuleActions');

const MUTATIONS: Record<string, { args: any[]; permission: string }> = {
  upsertBoardCloseRules: { args: ['board-1', {}], permission: 'update' },
  createBoardAutoCloseRule: { args: ['board-1', { trigger_status_id: 'open', inactivity_days: 4, close_to_status_id: 'closed' }], permission: 'create' },
  updateBoardAutoCloseRule: { args: ['rule-1', { trigger_status_id: 'open', inactivity_days: 4, close_to_status_id: 'closed' }], permission: 'update' },
  deleteBoardAutoCloseRule: { args: ['rule-1'], permission: 'delete' },
};
const POLICY_READS = {
  getBoardCloseRules: ['board-1'],
  getBoardAutoCloseRules: ['board-1'],
};

describe('close rule authorization', () => {
  beforeEach(() => {
    state.user = { user_id: 'user-1', user_type: 'client' };
    state.permissions = new Set();
    state.permissionCalls = [];
    state.queries = [];
    state.transactionCalls = [];
    state.authorizedTicket = {
      ticket_id: 'ticket-1', status_id: 'open', board_id: 'board-1',
      category_id: null, subcategory_id: null, priority_id: null, assigned_to: null,
    };
    state.authorizationError = null;
    state.closureFailures = [];
  });

  it.each(Object.entries(MUTATIONS))('%s rejects a client even when it has ticket:update, before policy lookup', async (name, { args }) => {
    state.permissions.add('ticket:update');
    const actions: any = await loadActions();
    const result = await actions[name](...args);

    expect(result).toMatchObject({ permissionError: expect.stringMatching(/internal users only/i) });
    expect(state.queries).toEqual([]);
    expect(state.permissionCalls).toEqual([]);
  });

  it.each(Object.entries(MUTATIONS))('%s requires its dedicated ticket_settings permission for internal callers', async (name, { args, permission }) => {
    state.user = { user_id: 'user-1', user_type: 'internal' };
    state.permissions.add('ticket:update');
    const actions: any = await loadActions();
    const result = await actions[name](...args);

    expect(result).toMatchObject({ permissionError: expect.stringMatching(/ticket policy settings/i) });
    expect(state.permissionCalls).toEqual([[ 'ticket_settings', permission, undefined ]]);
    expect(state.queries).toEqual([]);
  });

  it.each(Object.entries(MUTATIONS))('%s retains its mutation for an internal caller with the dedicated permission', async (name, { args, permission }) => {
    state.user = { user_id: 'user-1', user_type: 'internal' };
    state.permissions.add(`ticket_settings:${permission}`);
    const actions: any = await loadActions();

    const result = await actions[name](...args);

    expect(result == null || !('permissionError' in result || 'actionError' in result)).toBe(true);
    expect(state.permissionCalls).toEqual([[ 'ticket_settings', permission, undefined ]]);
    expect(state.queries.length).toBeGreaterThan(0);
  });

  it.each(Object.entries(POLICY_READS))('%s is internal-only and requires ticket_settings:read', async (name, args) => {
    const actions: any = await loadActions();
    await expect(actions[name](...args)).rejects.toThrow(/internal users only/i);
    expect(state.queries).toEqual([]);

    state.user = { user_id: 'user-1', user_type: 'internal' };
    await expect(actions[name](...args)).rejects.toThrow(/ticket policy settings/i);
    expect(state.permissionCalls).toEqual([[ 'ticket_settings', 'read', undefined ]]);
    expect(state.queries).toEqual([]);

    state.permissions.add('ticket_settings:read');
    const result = await actions[name](...args);
    expect(result).toBeDefined();
    expect(state.queries.length).toBeGreaterThan(0);
  });

  it('requires ticket:read before authorization or any ticket/status/policy evaluation', async () => {
    const { checkTicketClosure } = await loadActions();
    await expect(checkTicketClosure('ticket-1', 'closed')).rejects.toThrow(/ticket/i);

    expect(state.permissionCalls).toEqual([[ 'ticket', 'read', 'trx' ]]);
    expect(state.transactionCalls).toEqual(['trx']);
    expect(state.queries).toEqual([]);
  });

  it.each([
    ['Ticket not found', 'missing'],
    ['Permission denied: Cannot access ticket', 'hidden'],
  ])('returns the same not-found closure result for %s', async (message) => {
    state.permissions.add('ticket:read');
    state.authorizationError = new Error(message);
    const { checkTicketClosure } = await loadActions();

    const result = await checkTicketClosure('ticket-id', 'closed');

    expect(result).toEqual({
      wouldClose: true,
      allowed: false,
      failures: [{ rule: 'required_fields', message: 'Ticket not found. It may have been deleted. Please refresh and try again.' }],
      canOverride: false,
    });
    expect(state.queries.map(({ table }) => table)).toEqual(['authorize-ticket']);
  });

  it('evaluates authorized closure rules with the authorized tenant transaction and returns their result', async () => {
    state.permissions.add('ticket:read');
    state.closureFailures = [{ rule: 'time_entry', message: 'Add time before closing.' }];
    const { checkTicketClosure } = await loadActions();

    const result = await checkTicketClosure('ticket-1', 'closed');

    expect(result).toEqual({ wouldClose: true, allowed: false, failures: state.closureFailures, canOverride: false });
    expect(state.queries.filter(({ table }) => table === 'authorize-ticket')).toEqual([
      { conn: 'trx', table: 'authorize-ticket', op: 'read' },
    ]);
    expect(state.queries.filter(({ table }) => table === 'statuses').every(({ conn }) => conn === 'trx')).toBe(true);
    expect(state.queries.find(({ table }) => table === 'close-rule-evaluation')).toEqual({
      conn: 'trx', table: 'close-rule-evaluation', op: 'read',
    });
  });

  it('allows an authorized closure when the target closes the ticket and no close rules fail', async () => {
    state.permissions.add('ticket:read');
    const { checkTicketClosure } = await loadActions();

    const result = await checkTicketClosure('ticket-1', 'closed');

    expect(result).toEqual({ wouldClose: true, allowed: true, failures: [], canOverride: false });
    expect(state.queries.some(({ table }) => table === 'authorize-ticket')).toBe(true);
    expect(state.queries.some(({ table }) => table === 'close-rule-evaluation')).toBe(true);
  });
});
