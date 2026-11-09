import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  hasPermission: vi.fn(),
  tenantDbCalls: [] as string[],
  mutations: [] as string[],
  sessionUser: { user_id: 'msp-user', user_type: 'internal' as 'internal' | 'client', tenant: 'tenant-1' },
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) =>
    fn({ ...mocks.sessionUser }, { tenant: mocks.sessionUser.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: (connection: any) => ({
    table: (table: string) => {
      mocks.tenantDbCalls.push(table);
      return connection.table(table);
    },
  }),
}));

const permission = (action: string) => `ticket_settings:${action}`;

function grant(...permissions: string[]) {
  mocks.hasPermission.mockImplementation(async (_user: unknown, resource: string, action: string) =>
    permissions.includes(`${resource}:${action}`));
}

function makeConnection() {
  const defaults = {
    id: 'defaults-1', tenant: 'tenant-1', short_name: 'inbound', display_name: 'Inbound',
    board_id: 'board-1', status_id: 'status-1', priority_id: 'priority-1', client_id: 'client-1',
    entered_by: 'user-1', is_active: true,
  };
  const table = (tableName: string) => {
    let payload: any;
    const builder: any = {
      where: vi.fn(() => builder),
      orderBy: vi.fn(() => builder),
      select: vi.fn(() => builder),
      first: vi.fn(async () => tableName === 'statuses' ? { status_id: 'status-1' } : defaults),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(tableName === 'email_providers' ? [] : [defaults]).then(resolve),
      insert: vi.fn((value: any) => { payload = value; mocks.mutations.push(`insert:${tableName}`); return builder; }),
      update: vi.fn((value: any) => { payload = value; mocks.mutations.push(`update:${tableName}`); return builder; }),
      returning: vi.fn(async () => [{ ...defaults, ...payload }]),
      delete: vi.fn(async () => { mocks.mutations.push(`delete:${tableName}`); return 1; }),
    };
    return builder;
  };
  const connection: any = { table };
  connection.transaction = vi.fn(async (callback: (trx: any) => Promise<unknown>) => callback(connection));
  connection.fn = { now: () => 'now()' };
  connection.raw = (sql: string) => sql;
  return connection;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenantDbCalls.length = 0;
  mocks.mutations.length = 0;
  mocks.sessionUser.user_type = 'internal';
  mocks.createTenantKnex.mockResolvedValue({ knex: makeConnection() });
  grant();
});

describe('inbound ticket defaults action authorization', () => {
  it('rejects client users across all five actions before opening a tenant connection', async () => {
    mocks.sessionUser.user_type = 'client';
    const actions = await import('./inboundTicketDefaultsActions');

    const results = await Promise.all([
      actions.getInboundTicketDefaults(),
      actions.getInboundTicketDefaultsById('defaults-1'),
      actions.createInboundTicketDefaults({ short_name: 'x', display_name: 'X' }),
      actions.updateInboundTicketDefaults('defaults-1', { client_id: 'attacker-client' }),
      actions.deleteInboundTicketDefaults('defaults-1'),
    ]);

    expect(results[0]).toEqual({ defaults: [], error: 'Permission denied' });
    expect(results[1]).toEqual({ defaults: null, error: 'Permission denied' });
    expect(results.slice(2)).toEqual(Array(3).fill({ actionError: 'Permission denied', messageKey: 'errors.permissionDenied' }));
    expect(mocks.createTenantKnex).not.toHaveBeenCalled();
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(mocks.tenantDbCalls).toEqual([]);
    expect(mocks.mutations).toEqual([]);
  });

  it('rejects MSP reads without ticket_settings:read before reading defaults', async () => {
    const actions = await import('./inboundTicketDefaultsActions');
    const [list, byId] = await Promise.all([
      actions.getInboundTicketDefaults(),
      actions.getInboundTicketDefaultsById('defaults-1'),
    ]);

    expect(list).toEqual({ defaults: [], error: 'Permission denied' });
    expect(byId).toEqual({ defaults: null, error: 'Permission denied' });
    expect(mocks.hasPermission).toHaveBeenCalledTimes(2);
    expect(mocks.hasPermission).toHaveBeenCalledWith(expect.anything(), 'ticket_settings', 'read', expect.anything());
    expect(mocks.tenantDbCalls).toEqual([]);
  });

  it('rejects MSP mutations without ticket_settings:update and cannot persist caller-controlled routing or attribution', async () => {
    const actions = await import('./inboundTicketDefaultsActions');
    const result = await actions.updateInboundTicketDefaults('defaults-1', {
      client_id: 'attacker-client',
      board_id: 'attacker-board',
      status_id: 'attacker-status',
      priority_id: 'attacker-priority',
      entered_by: 'attacker-user',
    });

    expect(result).toEqual({ actionError: 'Permission denied', messageKey: 'errors.permissionDenied' });
    expect(mocks.hasPermission).toHaveBeenCalledWith(expect.anything(), 'ticket_settings', 'update', expect.anything());
    expect(mocks.tenantDbCalls).toEqual([]);
    expect(mocks.mutations).toEqual([]);
  });

  it('does not treat read permission as update permission for create, update, or delete', async () => {
    grant(permission('read'));
    const actions = await import('./inboundTicketDefaultsActions');

    const results = await Promise.all([
      actions.createInboundTicketDefaults({ short_name: 'x', display_name: 'X', board_id: 'board-1', status_id: 'status-1', priority_id: 'priority-1' }),
      actions.updateInboundTicketDefaults('defaults-1', { display_name: 'changed' }),
      actions.deleteInboundTicketDefaults('defaults-1'),
    ]);

    expect(results).toEqual(Array(3).fill({ actionError: 'Permission denied', messageKey: 'errors.permissionDenied' }));
    expect(mocks.hasPermission).toHaveBeenCalledTimes(3);
    expect(mocks.hasPermission).toHaveBeenCalledWith(expect.anything(), 'ticket_settings', 'update', expect.anything());
    expect(mocks.tenantDbCalls).toEqual([]);
    expect(mocks.mutations).toEqual([]);
  });

  it('allows authorized MSP reads and all mutation paths with the distinct permissions', async () => {
    grant(permission('read'), permission('update'));
    const actions = await import('./inboundTicketDefaultsActions');

    await expect(actions.getInboundTicketDefaults()).resolves.toMatchObject({ defaults: [expect.objectContaining({ id: 'defaults-1' })] });
    await expect(actions.getInboundTicketDefaultsById('defaults-1')).resolves.toMatchObject({ defaults: expect.objectContaining({ id: 'defaults-1' }) });
    await expect(actions.createInboundTicketDefaults({ short_name: 'new', display_name: 'New', board_id: 'board-1', status_id: 'status-1', priority_id: 'priority-1' })).resolves.toMatchObject({ defaults: expect.objectContaining({ short_name: 'new' }) });
    await expect(actions.updateInboundTicketDefaults('defaults-1', { display_name: 'Updated' })).resolves.toMatchObject({ defaults: expect.objectContaining({ display_name: 'Updated' }) });
    await expect(actions.deleteInboundTicketDefaults('defaults-1')).resolves.toEqual({ success: true });

    expect(mocks.hasPermission).toHaveBeenCalledWith(expect.anything(), 'ticket_settings', 'read', expect.anything());
    expect(mocks.hasPermission).toHaveBeenCalledWith(expect.anything(), 'ticket_settings', 'update', expect.anything());
    expect(mocks.mutations).toEqual(expect.arrayContaining([
      'insert:inbound_ticket_defaults',
      'update:inbound_ticket_defaults',
      'delete:inbound_ticket_defaults',
    ]));
  });
});
