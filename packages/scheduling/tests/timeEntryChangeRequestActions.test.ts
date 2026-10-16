import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INDEPENDENT_TENANT_ROW, fakeTable } from '@alga-psa/db/testing';

// The co-managed native-time seam rejects a tenant or sheet id that is not a
// uuid before it reads anything, so these fixtures look like real identifiers.
const TENANT = '00000000-0000-4000-8000-000000000001';
const SHEET_ID = '00000000-0000-4000-8000-000000000003';

const createTenantKnexMock = vi.fn();
const hasPermissionMock = vi.fn();
const assertCanActOnBehalfMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createTenantKnex: createTenantKnexMock,
  // The tenantDb facade applies the tenant predicate that production used to
  // pass explicitly. Mirror that here so the tenant-scoping assertions stay
  // meaningful: merge the (alias-qualified) tenant column into each .where().
  tenantDb: (conn: any, tenant: string) => {
    const tenantKeyFor = (expr: string) => {
      const alias = / as (\S+)/i.exec(expr);
      return alias ? `${alias[1]}.tenant` : 'tenant';
    };
    const scope = (qb: any, tenantKey: string): any =>
      new Proxy(qb, {
        get(target, prop, receiver) {
          if (prop === 'where') {
            return (criteria: any, ...rest: any[]) =>
              criteria && typeof criteria === 'object' && !Array.isArray(criteria) && rest.length === 0
                ? target.where({ ...criteria, [tenantKey]: tenant })
                : target.where(criteria, ...rest);
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    return {
      tenant,
      table: (expr: string) => scope(conn(expr), tenantKeyFor(expr)),
      unscoped: (expr: string) => conn(expr),
      tenantJoin: (query: any, expr: string, _left?: string, _right?: string, opts?: any) =>
        opts?.type === 'left' ? query.leftJoin?.(expr) ?? query : query.join?.(expr) ?? query,
    };
  },
}));

vi.mock('../src/actions/timeEntryDelegationAuth', () => ({
  assertCanActOnBehalf: (...args: any[]) => assertCanActOnBehalfMock(...args),
}));

describe('time entry change request action helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockResolvedValue(true);
    assertCanActOnBehalfMock.mockResolvedValue(undefined);
  });

  it('T004: createTimeEntryChangeRequestRecord persists author metadata and leaves handled metadata unresolved', async () => {
    const insertMock = vi.fn(async () => undefined);
    const db: any = Object.assign(
      (table: string) => {
        if (table !== 'time_entry_change_requests') {
          throw new Error(`Unexpected table ${table}`);
        }

        return {
          insert: insertMock,
        };
      },
      {
        fn: { now: () => 'NOW' },
        raw: (value: string) => value,
      },
    );

    const { createTimeEntryChangeRequestRecord } = await import('../src/actions/timeEntryChangeRequestActions');

    await createTimeEntryChangeRequestRecord(db, {
      tenant: TENANT,
      timeEntryId: 'entry-1',
      timeSheetId: SHEET_ID,
      comment: 'Please split travel time.',
      createdBy: 'manager-1',
    });

    expect(insertMock).toHaveBeenCalledWith({
      change_request_id: 'gen_random_uuid()',
      time_entry_id: 'entry-1',
      time_sheet_id: SHEET_ID,
      comment: 'Please split travel time.',
      created_by: 'manager-1',
      created_at: 'NOW',
      tenant: TENANT,
    });
  });

  it('T022: markTimeEntryChangeRequestsHandled writes handled metadata to every unresolved record for the entry', async () => {
    const updateMock = vi.fn(async () => undefined);
    const db: any = Object.assign(
      (_table: string) => {
        const builder: any = {
          where() {
            return builder;
          },
          whereNull() {
            return builder;
          },
          update: updateMock,
        };

        return builder;
      },
      {
        fn: { now: () => 'NOW' },
      },
    );

    const { markTimeEntryChangeRequestsHandled } = await import('../src/actions/timeEntryChangeRequestActions');

    await markTimeEntryChangeRequestsHandled(db, {
      tenant: TENANT,
      timeEntryId: 'entry-1',
      handledBy: 'user-1',
    });

    expect(updateMock).toHaveBeenCalledWith({
      handled_at: 'NOW',
      handled_by: 'user-1',
    });
  });

  it('T030/T031: fetchTimeEntryChangeRequestsForTimeSheet scopes reads to the authorized tenant and timesheet', async () => {
    const whereCalls: Record<string, any>[] = [];
    const db: any = Object.assign(
      (table: string) => {
        if (table === 'time_sheets') {
          return {
            where(criteria: Record<string, any>) {
              whereCalls.push(criteria);
              return {
                select() {
                  return {
                    first: async () => ({ user_id: 'user-1' }),
                  };
                },
              };
            },
          };
        }

        if (table === 'time_entry_change_requests as change_requests') {
          const builder: any = {
            leftJoin() {
              return builder;
            },
            where(criteria: Record<string, any>) {
              whereCalls.push(criteria);
              return builder;
            },
            select() {
              return builder;
            },
            orderBy() {
              return Promise.resolve([
                {
                  change_request_id: 'cr-1',
                  time_entry_id: 'entry-1',
                  time_sheet_id: SHEET_ID,
                  comment: 'Please split travel time.',
                  created_at: '2026-03-10T11:00:00.000Z',
                  created_by: 'manager-1',
                  handled_at: null,
                  handled_by: null,
                  created_by_name: 'Grace Hopper',
                  tenant: TENANT,
                },
              ]);
            },
          };

          return builder;
        }

        // Co-managed lifecycle admission reads the workspace product on the
        // way in; this suite is an independent PSA tenant, so the seam declines.
        return fakeTable({ tenantRow: { ...INDEPENDENT_TENANT_ROW, tenant: TENANT } }, TENANT, table.split(' ')[0]);
      },
      {
        raw: (_sql: string) => '',
        fn: { now: () => 'NOW' },
        isTransaction: true,
        transaction: async (callback: (trx: any) => Promise<any>) => callback(db),
      },
    );
    createTenantKnexMock.mockResolvedValue({ knex: db });

    const { fetchTimeEntryChangeRequestsForTimeSheet } = await import('../src/actions/timeEntryChangeRequestActions');

    const result = await (fetchTimeEntryChangeRequestsForTimeSheet as any)(
      { user_id: 'viewer-1' },
      { tenant: TENANT },
      SHEET_ID,
    );

    expect(result).toHaveLength(1);
    expect(result[0].created_by_name).toBe('Grace Hopper');
    expect(whereCalls).toContainEqual({ id: SHEET_ID, tenant: TENANT });
    expect(whereCalls).toContainEqual({
      'change_requests.time_sheet_id': SHEET_ID,
      'change_requests.tenant': TENANT,
    });
    expect(assertCanActOnBehalfMock).toHaveBeenCalledWith(
      { user_id: 'viewer-1' },
      TENANT,
      'user-1',
      db,
    );
  });
});
