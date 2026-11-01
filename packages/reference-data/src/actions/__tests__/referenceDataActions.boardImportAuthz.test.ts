/**
 * importReferenceData('boards') creates boards, so it must obey the same
 * policy as createBoard: internal principal + ticket_settings:create.
 * Previously the action only required a signed-in user.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { user_id: 'u1', user_type: 'internal', tenant: 't1' } as any,
  allowed: true,
}));
const createTenantKnexMock = vi.hoisted(() => vi.fn());
const withTransactionMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn());
const inserts = vi.hoisted(() => [] as any[]);

function queryFor(table: string): any {
  let pending: any[] | null = null;
  const rows = () => pending ?? (table === 'standard_boards'
    ? [{ id: 'b1', board_name: 'Support', display_order: 1, is_default: false }]
    : []);
  const builder: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: any) => unknown) => resolve(rows());
      if (prop === 'first') return async () => rows()[0];
      if (prop === 'insert') {
        return (payload: any) => {
          inserts.push({ table, payload });
          pending = Array.isArray(payload) ? payload : [payload];
          return builder;
        };
      }
      return () => builder;
    },
  });
  return builder;
}

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(state.user, { tenant: 't1' }, ...args),
  hasPermission: hasPermissionMock,
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: () => ({ table: (name: string) => queryFor(name) }),
  withTransaction: withTransactionMock,
}));
vi.mock('@alga-psa/core/server', () => ({ deleteEntityWithValidation: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(async () => undefined) }));

import { importReferenceData } from '../referenceDataActions';

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0;
  state.user = { user_id: 'u1', user_type: 'internal', tenant: 't1' };
  hasPermissionMock.mockImplementation(async () => state.allowed);
  state.allowed = true;
  const knex: any = (t: string) => queryFor(t);
  knex.raw = () => queryFor('__raw__');
  knex.fn = { now: () => 'now' };
  createTenantKnexMock.mockResolvedValue({ knex, tenant: 't1' });
  withTransactionMock.mockImplementation(async (_d: unknown, cb: any) => cb(knex));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe("importReferenceData('boards') authorization", () => {
  it('refuses an internal user lacking ticket_settings:create and writes nothing', async () => {
    state.allowed = false;
    const result: any = await importReferenceData('boards', ['b1']);
    expect(result.permissionError).toBeTruthy();
    expect(result.imported).toBeUndefined();
    expect(hasPermissionMock).toHaveBeenCalledWith(expect.anything(), 'ticket_settings', 'create', undefined);
    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it('refuses a client-portal user even if the permission check would pass', async () => {
    state.user = { user_id: 'c1', user_type: 'client', tenant: 't1' };
    const result: any = await importReferenceData('boards', ['b1']);
    expect(result.permissionError).toBeTruthy();
    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it('imports for a permitted internal user', async () => {
    const result: any = await importReferenceData('boards', ['b1']);
    expect(result.permissionError).toBeUndefined();
    expect(result.imported).toHaveLength(1);
    expect(inserts.length).toBeGreaterThan(0);
  });

  it('does not apply the board policy to other data types', async () => {
    state.allowed = false;
    await importReferenceData('priorities').catch(() => undefined);
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });
});
