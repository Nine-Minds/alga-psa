/**
 * Unit semantics for the project phase/task CSV importer:
 *
 * 1. CSV "Estimated Hours" are hours; project_tasks.estimated_hours is BIGINT
 *    minutes. Grouping has to convert, or "16" lands as 16 minutes and "0.25"
 *    fails the insert outright.
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

/** Chainable thenable stub — enough to let queries run without a database. */
function stubQuery(): any {
  const builder: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return undefined;
        if (prop === 'first') return async () => undefined;
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
  tenantDb: () => ({
    table: () => stubQuery(),
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

import { groupRowsIntoPhases } from './phaseTaskImportActions';

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionMock.mockResolvedValue(true);
  createTenantKnexMock.mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
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
