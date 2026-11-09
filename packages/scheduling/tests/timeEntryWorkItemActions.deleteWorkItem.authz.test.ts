import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  entries: [] as any[],
  sheetOwner: 'user-owner',
  caller: { user_id: 'user-owner', tenant: 'tenant-1' },
  canDelete: true,
  delegationDeniedFor: null as string | null,
  scopeQueries: [] as Record<string, unknown>[],
  coreCalls: [] as string[],
  rawDeleteCalls: 0,
}));
const createTenantKnexMock = vi.hoisted(() => vi.fn());
const tenantDbMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn());
const assertCanActOnBehalfMock = vi.hoisted(() => vi.fn());
const deleteTimeEntryCoreMock = vi.hoisted(() => vi.fn());
const recalculateMock = vi.hoisted(() => vi.fn());
const publishEventMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: tenantDbMock,
  recalculateProjectTaskActualHours: recalculateMock,
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(state.caller, { tenant: state.caller.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));
vi.mock('../src/actions/timeEntryDelegationAuth', () => ({
  assertCanActOnBehalf: assertCanActOnBehalfMock,
}));
vi.mock('../src/lib/timeEntryWriteCore', () => ({
  deleteTimeEntryCore: deleteTimeEntryCoreMock,
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: publishEventMock }));
vi.mock('../src/lib/timeSource', () => ({
  delegateToTimeSource: vi.fn(async () => ({ handled: false })),
}));

import { deleteWorkItem } from '../src/actions/timeEntryWorkItemActions';

function createDb() {
  const db: any = {};
  db.transaction = async (callback: (trx: any) => Promise<unknown>) => {
    const snapshot = state.entries.map((entry) => ({ ...entry }));
    try {
      return await callback(db);
    } catch (error) {
      state.entries = snapshot;
      throw error;
    }
  };
  return db;
}

function setupQueryDb() {
  const db = createDb();
  tenantDbMock.mockImplementation((_trx: unknown, tenant: string) => ({
    table: (tableName: string) => {
      let predicates: Record<string, unknown> = {};
      const query: any = {
        where: (where: Record<string, unknown>) => {
          predicates = where;
          if (tableName === 'time_entries') state.scopeQueries.push({ ...where, tenant });
          return query;
        },
        select: () => query,
        first: async () => tableName === 'time_sheets' ? { user_id: state.sheetOwner } : undefined,
        forUpdate: async () => state.entries.filter((entry) =>
          Object.entries(predicates).every(([key, value]) => entry[key] === value)
        ).map((entry) => ({ ...entry })),
        delete: async () => { state.rawDeleteCalls += 1; },
      };
      return query;
    },
  }));
  createTenantKnexMock.mockResolvedValue({ knex: db });
  hasPermissionMock.mockImplementation(async (_user: unknown, resource: string, action: string) =>
    resource === 'time_entry' && action === 'delete' && state.canDelete
  );
  assertCanActOnBehalfMock.mockImplementation(async (_user: unknown, _tenant: string, subject: string) => {
    if (subject === state.delegationDeniedFor) throw new Error('Permission denied: Cannot access other users time sheets');
  });
  deleteTimeEntryCoreMock.mockImplementation(async (_trx: unknown, _tenant: string, entryId: string, options: any) => {
    state.coreCalls.push(entryId);
    const entry = state.entries.find((item) => item.entry_id === entryId);
    await options.guard(entry);
    state.entries = state.entries.filter((item) => item.entry_id !== entryId);
    return { timeEntry: entry, deleteCount: 1 };
  });
}

function entry(entryId: string, values: Record<string, unknown> = {}) {
  return {
    entry_id: entryId,
    user_id: 'user-owner',
    invoiced: false,
    work_item_id: 'work-1',
    work_item_type: 'ticket',
    time_sheet_id: 'sheet-1',
    ...values,
  };
}

async function remove() {
  return deleteWorkItem('work-1', 'sheet-1', 'ticket');
}

describe('deleteWorkItem authorization and scope', () => {
  beforeEach(() => {
    state.entries = [];
    state.sheetOwner = 'user-owner';
    state.caller = { user_id: 'user-owner', tenant: 'tenant-1' };
    state.canDelete = true;
    state.delegationDeniedFor = null;
    state.scopeQueries = [];
    state.coreCalls = [];
    state.rawDeleteCalls = 0;
    createTenantKnexMock.mockReset();
    tenantDbMock.mockReset();
    hasPermissionMock.mockReset();
    assertCanActOnBehalfMock.mockReset();
    deleteTimeEntryCoreMock.mockReset();
    recalculateMock.mockReset();
    publishEventMock.mockReset();
    setupQueryDb();
  });

  it('rejects a delete-only caller without delegation authority and performs no entry deletes', async () => {
    state.caller = { user_id: 'user-finance', tenant: 'tenant-1' };
    state.sheetOwner = 'user-victim';
    state.delegationDeniedFor = 'user-victim';
    state.entries = [entry('victim-entry', { user_id: 'user-victim' })];

    await expect(remove()).resolves.toEqual({
      permissionError: 'Permission denied: Cannot access other users time sheets',
    });

    expect(state.entries.map((item) => item.entry_id)).toEqual(['victim-entry']);
    expect(deleteTimeEntryCoreMock).not.toHaveBeenCalled();
    expect(state.rawDeleteCalls).toBe(0);
  });

  it('deletes only the selected sheet, work item, and type through the shared core', async () => {
    state.entries = [
      entry('selected-a'),
      entry('selected-b'),
      entry('coworker-entry', { user_id: 'user-coworker', time_sheet_id: 'sheet-2' }),
      entry('other-sheet-entry', { time_sheet_id: 'sheet-2' }),
      entry('other-type-entry', { work_item_type: 'project_task' }),
      entry('other-item-entry', { work_item_id: 'work-2' }),
    ];

    await remove();

    expect(state.coreCalls).toEqual(['selected-a', 'selected-b']);
    expect(state.entries.map((item) => item.entry_id).sort()).toEqual([
      'coworker-entry', 'other-item-entry', 'other-sheet-entry', 'other-type-entry',
    ]);
    expect(state.scopeQueries).toEqual([{
      tenant: 'tenant-1', work_item_id: 'work-1', work_item_type: 'ticket', time_sheet_id: 'sheet-1',
    }]);
    expect(state.rawDeleteCalls).toBe(0);
    expect(publishEventMock).toHaveBeenCalledTimes(2);
  });

  it('rejects invoiced rows even when delegation is allowed and rolls back the whole attempt', async () => {
    state.entries = [entry('uninvoiced-first'), entry('invoiced-second', { invoiced: true })];

    await expect(remove()).resolves.toMatchObject({
      actionError: 'This time entry has already been invoiced and cannot be changed.',
    });

    expect(state.entries.map((item) => item.entry_id)).toEqual(['uninvoiced-first', 'invoiced-second']);
    expect(state.rawDeleteCalls).toBe(0);
  });

  it('keeps the coarse time_entry:delete permission check', async () => {
    state.canDelete = false;
    state.entries = [entry('entry-1')];

    await expect(remove()).resolves.toEqual({
      permissionError: 'Permission denied: Cannot delete work items for time entries',
    });

    expect(state.entries).toHaveLength(1);
    expect(deleteTimeEntryCoreMock).not.toHaveBeenCalled();
  });

  it('allows an authorized uninvoiced deletion', async () => {
    state.entries = [entry('entry-1')];

    await expect(remove()).resolves.toBeUndefined();

    expect(state.entries).toHaveLength(0);
    expect(state.coreCalls).toEqual(['entry-1']);
  });
});
