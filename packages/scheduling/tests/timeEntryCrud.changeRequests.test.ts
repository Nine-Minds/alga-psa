import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const createTenantKnexMock = vi.fn();
const hasPermissionMock = vi.fn();
const assertCanActOnBehalfMock = vi.fn();
const resolveUserTimeZoneMock = vi.fn();
const computeWorkDateFieldsMock = vi.fn();
const createTimeEntryChangeRequestRecordMock = vi.fn();
const fetchTimeEntryChangeRequestsForEntryIdsFromDbMock = vi.fn();
const markTimeEntryChangeRequestsHandledMock = vi.fn();
const determineDefaultContractLineMock = vi.fn(async () => null);

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  resolveUserTimeZone: (...args: any[]) => resolveUserTimeZoneMock(...args),
  computeWorkDateFields: (...args: any[]) => computeWorkDateFieldsMock(...args),
}));

vi.mock('../src/actions/timeEntryDelegationAuth', () => ({
  assertCanActOnBehalf: (...args: any[]) => assertCanActOnBehalfMock(...args),
}));

vi.mock('../src/lib/contractLineDisambiguation', () => ({
  determineDefaultContractLine: (...args: any[]) => determineDefaultContractLineMock(...args),
}));

vi.mock('../src/services/bucketUsageService', () => ({
  findOrCreateCurrentBucketUsageRecord: vi.fn(),
  updateBucketUsageMinutes: vi.fn(),
}));

vi.mock('../src/actions/timeEntryHelpers', () => ({
  getClientIdForWorkItem: vi.fn(async () => null),
}));

vi.mock('../src/actions/timeEntryChangeRequestActions', () => ({
  createTimeEntryChangeRequestRecord: (...args: any[]) => createTimeEntryChangeRequestRecordMock(...args),
  fetchTimeEntryChangeRequestsForEntryIdsFromDb: (...args: any[]) => fetchTimeEntryChangeRequestsForEntryIdsFromDbMock(...args),
  markTimeEntryChangeRequestsHandled: (...args: any[]) => markTimeEntryChangeRequestsHandledMock(...args),
}));

type DbStubConfig = {
  existingEntry: Record<string, any>;
  updatedEntry?: Record<string, any>;
  timeSheetStatus?: string;
  initialBillableDuration?: number;
};

function createDbStub(config: DbStubConfig) {
  const calls = {
    entryUpdates: [] as Array<{ criteria: Record<string, any>; payload: Record<string, any> }>,
    sheetUpdates: [] as Array<{ criteria: Record<string, any>; payload: Record<string, any> }>,
  };

  const db: any = (table: string) => {
    const state: { criteria?: Record<string, any>; selectColumns?: string[] } = {};

    const builder: any = {
      where(criteria: Record<string, any>) {
        state.criteria = criteria;
        return builder;
      },
      select(...columns: string[]) {
        state.selectColumns = columns;
        return builder;
      },
      first(...columns: string[]) {
        if (columns.length > 0) {
          state.selectColumns = columns;
        }

        if (table === 'time_entries') {
          if (state.selectColumns?.includes('billable_duration')) {
            return Promise.resolve({ billable_duration: config.initialBillableDuration ?? 0 });
          }

          return Promise.resolve(config.existingEntry);
        }

        if (table === 'time_sheets') {
          return Promise.resolve({ approval_status: config.timeSheetStatus ?? 'CHANGES_REQUESTED' });
        }
        if (table === 'tickets') {
          return Promise.resolve({ client_id: 'client-1' });
        }

        throw new Error(`Unexpected first() call for table ${table}`);
      },
      update(payload: Record<string, any>) {
        if (!state.criteria) {
          throw new Error(`Missing criteria for ${table} update`);
        }

        if (table === 'time_entries') {
          calls.entryUpdates.push({ criteria: state.criteria, payload });
          const updateResult = config.updatedEntry ? [config.updatedEntry] : 1;
          return {
            returning: async () => updateResult,
            then: (resolve: (value: any) => any) => Promise.resolve(updateResult).then(resolve),
          };
        }

        if (table === 'time_sheets') {
          calls.sheetUpdates.push({ criteria: state.criteria, payload });
          return Promise.resolve(1);
        }

        throw new Error(`Unexpected update() call for table ${table}`);
      },
    };

    return builder;
  };

  db.transaction = async (callback: (trx: any) => Promise<any>) => callback(db);
  db.fn = { now: () => 'NOW' };
  db.raw = (value: string) => value;

  return { db, calls };
}

function createFetchEntriesDbStub() {
  const db: any = Object.assign((table: string) => {
    if (table === 'time_sheets') {
      return {
        where() {
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

    if (table === 'time_entries') {
      const builder: any = {
        where() {
          return builder;
        },
        orderBy() {
          return builder;
        },
        select() {
          return Promise.resolve([
            {
              entry_id: 'entry-1',
              work_item_id: null,
              work_item_type: 'non_billable_category',
              start_time: new Date('2026-03-10T09:00:00.000Z'),
              end_time: new Date('2026-03-10T10:00:00.000Z'),
              created_at: new Date('2026-03-10T09:00:00.000Z'),
              updated_at: new Date('2026-03-10T10:00:00.000Z'),
              billable_duration: 0,
              notes: 'Internal admin time',
              user_id: 'user-1',
              time_sheet_id: 'sheet-1',
              approval_status: 'DRAFT',
              tenant: 'tenant-1',
              work_date: '2026-03-10',
              service_id: undefined,
            },
          ]);
        },
      };

      return builder;
    }

    if (table === 'service_catalog as sc') {
      const builder: any = {
        leftJoin() {
          return builder;
        },
        where() {
          return builder;
        },
        select() {
          return Promise.resolve([]);
        },
      };

      return builder;
    }

    throw new Error(`Unexpected table ${table}`);
  }, {
    raw: (value: string) => value,
  });

  return db;
}

describe('time entry change-request action integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockResolvedValue(true);
    assertCanActOnBehalfMock.mockResolvedValue(undefined);
    resolveUserTimeZoneMock.mockResolvedValue('America/New_York');
    computeWorkDateFieldsMock.mockImplementation((value: string) => ({
      work_date: value.slice(0, 10),
      work_timezone: 'America/New_York',
    }));
    fetchTimeEntryChangeRequestsForEntryIdsFromDbMock.mockResolvedValue(new Map());
  });

  it('T003/T025: requesting changes creates a change-request record and keeps creating new records across review cycles', async () => {
    const { db, calls } = createDbStub({
      existingEntry: {
        entry_id: 'entry-1',
        user_id: 'user-1',
        invoiced: false,
        time_sheet_id: 'sheet-1',
      },
    });
    createTenantKnexMock.mockResolvedValue({ knex: db });

    const { updateTimeEntryApprovalStatus } = await import('../src/actions/timeEntryCrudActions');

    await (updateTimeEntryApprovalStatus as any)(
      { user_id: 'manager-1' },
      { tenant: 'tenant-1' },
      {
        entryId: 'entry-1',
        approvalStatus: 'CHANGES_REQUESTED',
        changeRequestComment: 'Please break out travel time.',
      },
    );

    await (updateTimeEntryApprovalStatus as any)(
      { user_id: 'manager-1' },
      { tenant: 'tenant-1' },
      {
        entryId: 'entry-1',
        approvalStatus: 'CHANGES_REQUESTED',
        changeRequestComment: 'Please attach the client note too.',
      },
    );

    expect(calls.entryUpdates).toHaveLength(2);
    expect(calls.sheetUpdates).toHaveLength(2);
    expect(createTimeEntryChangeRequestRecordMock).toHaveBeenCalledTimes(2);
    expect(createTimeEntryChangeRequestRecordMock).toHaveBeenNthCalledWith(1, db, {
      tenant: 'tenant-1',
      timeEntryId: 'entry-1',
      timeSheetId: 'sheet-1',
      comment: 'Please break out travel time.',
      createdBy: 'manager-1',
    });
    expect(createTimeEntryChangeRequestRecordMock).toHaveBeenNthCalledWith(2, db, {
      tenant: 'tenant-1',
      timeEntryId: 'entry-1',
      timeSheetId: 'sheet-1',
      comment: 'Please attach the client note too.',
      createdBy: 'manager-1',
    });
  });

  it('T005: blocks change-request creation when the user lacks approval permission', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { db } = createDbStub({
      existingEntry: {
        entry_id: 'entry-1',
        user_id: 'user-1',
        invoiced: false,
        time_sheet_id: 'sheet-1',
      },
    });
    createTenantKnexMock.mockResolvedValue({ knex: db });

    const { updateTimeEntryApprovalStatus } = await import('../src/actions/timeEntryCrudActions');

    await expect(
      (updateTimeEntryApprovalStatus as any)(
        { user_id: 'manager-1' },
        { tenant: 'tenant-1' },
        {
          entryId: 'entry-1',
          approvalStatus: 'CHANGES_REQUESTED',
          changeRequestComment: 'Please fix this.',
        },
      ),
    ).rejects.toThrow('Permission denied: Cannot update time entry approval status');

    expect(createTimeEntryChangeRequestRecordMock).not.toHaveBeenCalled();
  });

  it('T021/T023/T024/T029: saving an edited entry auto-handles only that entry during CHANGES_REQUESTED and never creates approver feedback', async () => {
    const { db } = createDbStub({
      existingEntry: {
        entry_id: 'entry-1',
        user_id: 'user-1',
        invoiced: false,
        time_sheet_id: 'sheet-1',
      },
      updatedEntry: {
        entry_id: 'entry-1',
        work_item_id: 'non-billable',
        work_item_type: 'non_billable_category',
        start_time: '2026-03-10T09:00:00.000Z',
        end_time: '2026-03-10T10:00:00.000Z',
        created_at: '2026-03-10T09:00:00.000Z',
        updated_at: '2026-03-10T10:00:00.000Z',
        billable_duration: 0,
        notes: 'Updated notes',
        user_id: 'user-1',
        time_sheet_id: 'sheet-1',
        approval_status: 'DRAFT',
        service_id: 'service-1',
        tenant: 'tenant-1',
      },
      timeSheetStatus: 'CHANGES_REQUESTED',
      initialBillableDuration: 0,
    });
    createTenantKnexMock.mockResolvedValue({ knex: db });

    const { saveTimeEntry } = await import('../src/actions/timeEntryCrudActions');

    await (saveTimeEntry as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      {
        entry_id: 'entry-1',
        work_item_id: 'non-billable',
        work_item_type: 'non_billable_category',
        start_time: '2026-03-10T09:00:00.000Z',
        end_time: '2026-03-10T10:00:00.000Z',
        created_at: '2026-03-10T09:00:00.000Z',
        updated_at: '2026-03-10T09:00:00.000Z',
        billable_duration: 0,
        notes: 'Updated notes',
        user_id: 'user-1',
        approval_status: 'DRAFT',
        service_id: 'service-1',
      },
    );

    expect(markTimeEntryChangeRequestsHandledMock).toHaveBeenCalledWith(db, {
      tenant: 'tenant-1',
      timeEntryId: 'entry-1',
      handledBy: 'user-1',
    });
    expect(markTimeEntryChangeRequestsHandledMock).not.toHaveBeenCalledWith(db, {
      tenant: 'tenant-1',
      timeEntryId: 'entry-2',
      handledBy: 'user-1',
    });
    expect(createTimeEntryChangeRequestRecordMock).not.toHaveBeenCalled();
  });

  it('does not auto-handle feedback when saving outside the changes-requested flow', async () => {
    const { db } = createDbStub({
      existingEntry: {
        entry_id: 'entry-1',
        user_id: 'user-1',
        invoiced: false,
        time_sheet_id: 'sheet-1',
      },
      updatedEntry: {
        entry_id: 'entry-1',
        work_item_id: 'non-billable',
        work_item_type: 'non_billable_category',
        start_time: '2026-03-10T09:00:00.000Z',
        end_time: '2026-03-10T10:00:00.000Z',
        created_at: '2026-03-10T09:00:00.000Z',
        updated_at: '2026-03-10T10:00:00.000Z',
        billable_duration: 0,
        notes: 'Updated notes',
        user_id: 'user-1',
        time_sheet_id: 'sheet-1',
        approval_status: 'DRAFT',
        service_id: 'service-1',
        tenant: 'tenant-1',
      },
      timeSheetStatus: 'SUBMITTED',
      initialBillableDuration: 0,
    });
    createTenantKnexMock.mockResolvedValue({ knex: db });

    const { saveTimeEntry } = await import('../src/actions/timeEntryCrudActions');

    await (saveTimeEntry as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      {
        entry_id: 'entry-1',
        work_item_id: 'non-billable',
        work_item_type: 'non_billable_category',
        start_time: '2026-03-10T09:00:00.000Z',
        end_time: '2026-03-10T10:00:00.000Z',
        created_at: '2026-03-10T09:00:00.000Z',
        updated_at: '2026-03-10T09:00:00.000Z',
        billable_duration: 0,
        notes: 'Updated notes',
        user_id: 'user-1',
        approval_status: 'DRAFT',
        service_id: 'service-1',
      },
    );

    expect(markTimeEntryChangeRequestsHandledMock).not.toHaveBeenCalled();
  });

  it('T003: saveTimeEntry resolves default contract line using effective work date for backdated/current/future entries', async () => {
    const { saveTimeEntry } = await import('../src/actions/timeEntryCrudActions');

    const scenarios = [
      { label: 'backdated', startTime: '2025-01-15T09:00:00.000Z', expectedEffectiveDate: '2025-01-15' },
      { label: 'current', startTime: '2026-03-10T09:00:00.000Z', expectedEffectiveDate: '2026-03-10' },
      { label: 'future', startTime: '2027-11-02T09:00:00.000Z', expectedEffectiveDate: '2027-11-02' },
    ];

    for (const scenario of scenarios) {
      determineDefaultContractLineMock.mockClear();
      determineDefaultContractLineMock.mockResolvedValueOnce(null);
      const { db } = createDbStub({
        existingEntry: {
          entry_id: `entry-${scenario.label}`,
          user_id: 'user-1',
          invoiced: false,
          time_sheet_id: 'sheet-1',
        },
        updatedEntry: {
          entry_id: `entry-${scenario.label}`,
          work_item_id: 'non-billable',
          work_item_type: 'non_billable_category',
          start_time: scenario.startTime,
          end_time: scenario.startTime.replace('09:00:00.000Z', '10:00:00.000Z'),
          created_at: scenario.startTime,
          updated_at: scenario.startTime,
          billable_duration: 60,
          notes: `${scenario.label} update`,
          user_id: 'user-1',
          time_sheet_id: 'sheet-1',
          approval_status: 'DRAFT',
          service_id: 'service-1',
          tenant: 'tenant-1',
        },
        timeSheetStatus: 'SUBMITTED',
        initialBillableDuration: 60,
      });
      createTenantKnexMock.mockResolvedValue({ knex: db });

      await (saveTimeEntry as any)(
        { user_id: 'user-1' },
        { tenant: 'tenant-1' },
        {
          entry_id: `entry-${scenario.label}`,
          work_item_id: 'non-billable',
          work_item_type: 'non_billable_category',
          start_time: scenario.startTime,
          end_time: scenario.startTime.replace('09:00:00.000Z', '10:00:00.000Z'),
          created_at: scenario.startTime,
          updated_at: scenario.startTime,
          billable_duration: 60,
          notes: `${scenario.label} update`,
          user_id: 'user-1',
          approval_status: 'DRAFT',
          service_id: 'service-1',
        },
      );

      expect(determineDefaultContractLineMock).toHaveBeenCalledWith(
        null,
        'service-1',
        scenario.expectedEffectiveDate,
      );
    }
  });

  it('rejects save payloads that omit service_id', async () => {
    const { saveTimeEntryParamsSchema } = await import('../src/actions/timeEntrySchemas');

    expect(() => saveTimeEntryParamsSchema.parse({
      entry_id: 'entry-1',
      work_item_id: 'non-billable',
      work_item_type: 'non_billable_category',
      start_time: '2026-03-10T09:00:00.000Z',
      end_time: '2026-03-10T10:00:00.000Z',
      created_at: '2026-03-10T09:00:00.000Z',
      updated_at: '2026-03-10T09:00:00.000Z',
      billable_duration: 0,
      notes: 'Updated notes',
      user_id: 'user-1',
      approval_status: 'DRAFT',
      tenant: 'tenant-1',
    })).toThrowError(ZodError);
  });

  it('T012: fetchTimeEntriesForTimeSheet returns entry-level feedback alongside entry data', async () => {
    const db = createFetchEntriesDbStub();
    createTenantKnexMock.mockResolvedValue({ knex: db });
    fetchTimeEntryChangeRequestsForEntryIdsFromDbMock.mockResolvedValue(
      new Map([
        [
          'entry-1',
          [
            {
              change_request_id: 'cr-1',
              time_entry_id: 'entry-1',
              time_sheet_id: 'sheet-1',
              comment: 'Please split out the admin block.',
              created_at: '2026-03-10T11:00:00.000Z',
              created_by: 'manager-1',
              tenant: 'tenant-1',
            },
          ],
        ],
      ]),
    );

    const { fetchTimeEntriesForTimeSheet } = await import('../src/actions/timeEntryCrudActions');

    const result = await (fetchTimeEntriesForTimeSheet as any)(
      { user_id: 'viewer-1' },
      { tenant: 'tenant-1' },
      'sheet-1',
    );

    expect(result).toHaveLength(1);
    expect(result[0].latest_change_request?.change_request_id).toBe('cr-1');
    expect(result[0].change_request_state).toBe('unresolved');
    expect(result[0].change_requests?.[0].comment).toBe('Please split out the admin block.');
  });
});
