import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const hasPermissionMock = vi.fn();
const assertCanActOnBehalfMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
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
      tenant: 'tenant-1',
      timeEntryId: 'entry-1',
      timeSheetId: 'sheet-1',
      comment: 'Please split travel time.',
      createdBy: 'manager-1',
    });

    expect(insertMock).toHaveBeenCalledWith({
      change_request_id: 'gen_random_uuid()',
      time_entry_id: 'entry-1',
      time_sheet_id: 'sheet-1',
      comment: 'Please split travel time.',
      created_by: 'manager-1',
      created_at: 'NOW',
      tenant: 'tenant-1',
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
      tenant: 'tenant-1',
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
                  time_sheet_id: 'sheet-1',
                  comment: 'Please split travel time.',
                  created_at: '2026-03-10T11:00:00.000Z',
                  created_by: 'manager-1',
                  handled_at: null,
                  handled_by: null,
                  created_by_name: 'Grace Hopper',
                  tenant: 'tenant-1',
                },
              ]);
            },
          };

          return builder;
        }

        throw new Error(`Unexpected table ${table}`);
      },
      {
        raw: (_sql: string) => '',
      },
    );
    createTenantKnexMock.mockResolvedValue({ knex: db });

    const { fetchTimeEntryChangeRequestsForTimeSheet } = await import('../src/actions/timeEntryChangeRequestActions');

    const result = await (fetchTimeEntryChangeRequestsForTimeSheet as any)(
      { user_id: 'viewer-1' },
      { tenant: 'tenant-1' },
      'sheet-1',
    );

    expect(result).toHaveLength(1);
    expect(result[0].created_by_name).toBe('Grace Hopper');
    expect(whereCalls).toContainEqual({ id: 'sheet-1', tenant: 'tenant-1' });
    expect(whereCalls).toContainEqual({
      'change_requests.time_sheet_id': 'sheet-1',
      'change_requests.tenant': 'tenant-1',
    });
    expect(assertCanActOnBehalfMock).toHaveBeenCalledWith(
      { user_id: 'viewer-1' },
      'tenant-1',
      'user-1',
      db,
    );
  });
});
