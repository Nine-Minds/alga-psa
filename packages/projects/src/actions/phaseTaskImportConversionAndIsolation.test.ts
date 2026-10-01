/**
 * Unit semantics for the project phase/task CSV importer:
 *
 * 1. CSV "Estimated Hours" are hours; project_tasks.estimated_hours is BIGINT
 *    minutes. Grouping has to convert, or "16" lands as 16 minutes and "0.25"
 *    fails the insert outright.
 * 2. One failing row must not take the rest of the import down with it. Each row
 *    runs in its own savepoint, so the returned counts describe rows that really
 *    persisted and the error list names the CSV row that failed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITaskImportRow } from '@alga-psa/types';

const hasPermissionMock = vi.hoisted(() => vi.fn());
const createTenantKnexMock = vi.hoisted(() => vi.fn());
const withTransactionMock = vi.hoisted(() => vi.fn());
const addPhaseMock = vi.hoisted(() => vi.fn());
const addTaskMock = vi.hoisted(() => vi.fn());
const addTaskResourceMock = vi.hoisted(() => vi.fn());
const createTagsMock = vi.hoisted(() => vi.fn());
const publishWorkflowEventMock = vi.hoisted(() => vi.fn());

/**
 * Fake transaction handle that mimics Postgres' poisoning rule: once a statement
 * fails on a handle, every later statement on that same handle fails too. Nested
 * handles are savepoints — their abort stays contained.
 */
interface FakeTrx {
  aborted: boolean;
  raw: (sql: string) => string;
  transaction: <T>(cb: (child: FakeTrx) => Promise<T>) => Promise<T>;
}

const ABORTED_MESSAGE = 'current transaction is aborted, commands ignored until end of transaction block';

function createFakeTrx(): FakeTrx {
  const trx: FakeTrx = {
    aborted: false,
    raw: (sql: string) => {
      if (trx.aborted) throw new Error(ABORTED_MESSAGE);
      return sql;
    },
    transaction: async <T,>(cb: (child: FakeTrx) => Promise<T>): Promise<T> => {
      if (trx.aborted) throw new Error(ABORTED_MESSAGE);
      // ROLLBACK TO SAVEPOINT discards only the child's work.
      return cb(createFakeTrx());
    },
  };
  return trx;
}

/** Chainable thenable stub — enough to let queries run without a database. */
function stubQuery(conn?: { aborted?: boolean }): any {
  const builder: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return undefined;
        if (prop === 'first') {
          return async () => {
            if (conn?.aborted) throw new Error(ABORTED_MESSAGE);
            return undefined;
          };
        }
        return () => builder;
      },
    },
  );
  return builder;
}

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: hasPermissionMock }));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: (conn: any) => ({
    table: () => stubQuery(conn),
    tenantJoin: (query: any) => query,
  }),
}));

vi.mock('@alga-psa/shared/db', () => ({ withTransaction: withTransactionMock }));
vi.mock('@alga-psa/core', () => ({ unparseCSV: vi.fn(() => '') }));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getAllUsersBasic: vi.fn(async () => []),
}));
vi.mock('@alga-psa/reference-data/actions/priorityActions', () => ({
  getAllPriorities: vi.fn(async () => []),
}));
vi.mock('./serviceCatalogActions', () => ({ getServices: vi.fn(async () => []) }));
vi.mock('@alga-psa/tags/actions/tagActions', () => ({
  createTagsForEntityWithTransaction: createTagsMock,
}));
vi.mock('@alga-psa/projects/models/project', () => ({
  default: {
    getById: vi.fn(async () => ({ project_id: 'project-1', wbs_code: '1' })),
    getProjectStatusMappings: vi.fn(async () => [
      {
        project_status_mapping_id: 'psm-1',
        custom_name: 'Open',
        status_name: 'Open',
        name: 'Open',
        phase_id: null,
      },
    ]),
    getPhases: vi.fn(async () => []),
    addPhase: addPhaseMock,
  },
}));
vi.mock('../models/projectTask', () => ({
  default: { addTask: addTaskMock, addTaskResource: addTaskResourceMock },
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: publishWorkflowEventMock }));
vi.mock('@alga-psa/workflow-streams', () => ({
  buildProjectTaskAssignedPayload: vi.fn(() => ({})),
  buildProjectTaskCreatedPayload: vi.fn(() => ({})),
}));

import { groupRowsIntoPhases, importPhasesAndTasks } from './phaseTaskImportActions';

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionMock.mockResolvedValue(true);
  createTenantKnexMock.mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
  withTransactionMock.mockImplementation(async (_db: unknown, cb: any) => cb(createFakeTrx()));
  addPhaseMock.mockImplementation(async (trx: FakeTrx, _tenant: string, phaseData: any) => {
    if (trx.aborted) throw new Error(ABORTED_MESSAGE);
    return { phase_id: 'phase-1', wbs_code: '1.1', ...phaseData };
  });
  addTaskResourceMock.mockResolvedValue(undefined);
  createTagsMock.mockResolvedValue(undefined);
  publishWorkflowEventMock.mockResolvedValue(undefined);
});

function row(overrides: Partial<ITaskImportRow>): ITaskImportRow {
  return { phase_name: 'Planning', task_name: 'Task', ...overrides };
}

describe('groupRowsIntoPhases estimated hours', () => {
  it('converts CSV hours into the minutes project_tasks stores', async () => {
    const grouped = await groupRowsIntoPhases(
      [
        row({ task_name: 'Whole hours', estimated_hours: '16' }),
        row({ task_name: 'Fractional hours', estimated_hours: '0.25' }),
        row({ task_name: 'Blank hours', estimated_hours: '' }),
        row({ task_name: 'Negative hours', estimated_hours: '-3' }),
        row({ task_name: 'Missing hours' }),
      ],
      {},
      {},
      {},
    );

    const byName = Object.fromEntries(
      grouped[0].tasks.map((task) => [task.task_name, task.estimated_hours]),
    );

    expect(byName['Whole hours']).toBe(960);
    expect(byName['Fractional hours']).toBe(15);
    expect(byName['Blank hours']).toBeNull();
    expect(byName['Negative hours']).toBeNull();
    expect(byName['Missing hours']).toBeNull();
  });
});

describe('importPhasesAndTasks row isolation', () => {
  const groupedPhases = [
    {
      phase_name: 'Planning',
      description: null,
      tasks: [
        {
          task_name: 'Good first',
          description: null,
          assigned_to: null,
          additional_agent_ids: [],
          estimated_hours: 960,
          actual_hours: null,
          due_date: null,
          priority_id: null,
          service_id: null,
          task_type_key: 'task',
          status_name: null,
          status_mapping_id: null,
          tags: [],
          csvRowNumber: 2,
        },
        {
          task_name: 'Poisoned',
          description: null,
          assigned_to: null,
          additional_agent_ids: [],
          estimated_hours: 15,
          actual_hours: null,
          due_date: null,
          priority_id: null,
          service_id: null,
          task_type_key: 'task',
          status_name: null,
          status_mapping_id: null,
          tags: [],
          csvRowNumber: 3,
        },
        {
          task_name: 'Good last',
          description: null,
          assigned_to: null,
          additional_agent_ids: [],
          estimated_hours: 30,
          actual_hours: null,
          due_date: null,
          priority_id: null,
          service_id: null,
          task_type_key: 'task',
          status_name: null,
          status_mapping_id: null,
          tags: [],
          csvRowNumber: 4,
        },
      ],
    },
  ];

  beforeEach(() => {
    let taskCounter = 0;
    addTaskMock.mockImplementation(async (trx: FakeTrx, _tenant: string, phaseId: string, taskData: any) => {
      // A poisoned statement aborts the handle it ran on, exactly like Postgres.
      if (trx.aborted) throw new Error(ABORTED_MESSAGE);
      if (taskData.task_name === 'Poisoned') {
        trx.aborted = true;
        throw new Error('bigint out of range');
      }
      taskCounter += 1;
      return {
        task_id: `task-${taskCounter}`,
        task_name: taskData.task_name,
        phase_id: phaseId,
        assigned_to: taskData.assigned_to,
        due_date: taskData.due_date,
        estimated_hours: taskData.estimated_hours,
        project_status_mapping_id: taskData.project_status_mapping_id,
        created_at: new Date('2026-09-22T00:00:00.000Z'),
      };
    });
  });

  it('persists the healthy rows and reports only the failing CSV row', async () => {
    const result = await importPhasesAndTasks('project-1', groupedPhases as any);

    expect(result.success).toBe(false);
    expect(result.phasesCreated).toBe(1);
    // Counts describe rows that really persisted — the failed row is not counted,
    // and the rows after it are not collateral damage.
    expect(result.tasksCreated).toBe(2);
    expect(addTaskMock.mock.calls.map((call) => call[3].task_name)).toEqual([
      'Good first',
      'Poisoned',
      'Good last',
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('row 3');
    expect(result.errors[0]).toContain('Poisoned');
  });

  it('runs each row on its own savepoint handle, not the shared transaction', async () => {
    await importPhasesAndTasks('project-1', groupedPhases as any);

    const handles = addTaskMock.mock.calls.map((call) => call[0]);
    expect(new Set(handles).size).toBe(handles.length);
  });

  it('emits no workflow events for a rolled-back row', async () => {
    await importPhasesAndTasks('project-1', groupedPhases as any);

    // Two created rows, no assignees => two PROJECT_TASK_CREATED events.
    expect(publishWorkflowEventMock).toHaveBeenCalledTimes(2);
    expect(
      publishWorkflowEventMock.mock.calls.every(([event]) => event.eventType === 'PROJECT_TASK_CREATED'),
    ).toBe(true);
  });
});
