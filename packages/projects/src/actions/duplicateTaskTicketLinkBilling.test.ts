/**
 * Duplicating a task must not move anybody's money: a reference-only ticket
 * link (bill_under_project = false) has to stay reference-only on the copy,
 * the same way the workflow copy path preserves it (alga-2026-0002622).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));
const createTenantKnexMock = vi.hoisted(() => vi.fn());
const getTaskTicketLinksMock = vi.hoisted(() => vi.fn());
const addTaskTicketLinkMock = vi.hoisted(() => vi.fn(async () => ({ link_id: 'copy-link' })));
const addTaskMock = vi.hoisted(() =>
  vi.fn(async () => ({
    task_id: 'task-copy',
    phase_id: 'phase-2',
    task_name: 'Fix printer (Copy)',
    project_status_mapping_id: 'psm-1',
    assigned_to: null,
    due_date: null,
    created_at: new Date('2026-10-01T00:00:00.000Z'),
  })),
);

/** Chainable thenable stub — enough to let queries run without a database. */
function stubQuery(firstRow: unknown = undefined): any {
  const builder: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject);
        if (prop === 'catch') return (fn: any) => Promise.resolve([]).catch(fn);
        if (prop === 'first') return async () => firstRow;
        return () => builder;
      },
    },
  );
  return builder;
}

/** The only row the duplicate path reads straight from the database. */
function stubTable(table: string): any {
  return stubQuery(table.startsWith('project_phases') ? { project_id: 'project-1' } : undefined);
}

const trxStub: any = Object.assign(() => stubQuery(), {
  raw: (sql: string) => sql,
  fn: { now: () => 'now()' },
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn(
      { user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1', roles: [] },
      { tenant: 'tenant-1' },
      ...args,
    ),
  localizeActionError: (error: unknown) => error,
}));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: hasPermissionMock }));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: () => ({
    table: (table: string) => stubTable(table),
    tenantJoin: (query: any) => query,
  }),
  withTransaction: async (_db: unknown, work: (trx: any) => Promise<unknown>) => work(trxStub),
}));

vi.mock('../models/projectTask', () => ({
  default: {
    getTaskById: vi.fn(async (_trx: unknown, _tenant: string, taskId: string) =>
      taskId === 'task-original'
        ? {
            task_id: 'task-original',
            phase_id: 'phase-1',
            task_name: 'Fix printer',
            description: null,
            description_rich_text: null,
            due_date: null,
            estimated_hours: 0,
            assigned_to: 'user-2',
            project_status_mapping_id: 'psm-1',
            task_type_key: 'task',
          }
        : {
            task_id: 'task-copy',
            phase_id: 'phase-2',
            task_name: 'Fix printer (Copy)',
            project_status_mapping_id: 'psm-1',
          },
    ),
    addTask: addTaskMock,
    getTaskTicketLinks: getTaskTicketLinksMock,
    addTaskTicketLink: addTaskTicketLinkMock,
    getChecklistItems: vi.fn(async () => []),
    getTaskResources: vi.fn(async () => []),
  },
}));

vi.mock('@alga-psa/projects/models/project', () => ({
  default: {
    getById: vi.fn(async () => ({ project_id: 'project-1', client_id: 'client-1', assigned_to: null })),
    getPhaseById: vi.fn(async (_trx: unknown, _tenant: string, phaseId: string) => ({
      phase_id: phaseId,
      project_id: 'project-1',
    })),
  },
}));

vi.mock('../models/taskType', () => ({ default: {} }));
vi.mock('../models/taskDependency', () => ({ default: {} }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));
vi.mock('@alga-psa/workflow-streams', () => ({
  buildProjectTaskAssignedPayload: vi.fn(() => ({})),
  buildProjectTaskCompletedPayload: vi.fn(() => ({})),
  buildProjectTaskCreatedPayload: vi.fn(() => ({})),
  buildProjectTaskDependencyBlockedPayload: vi.fn(() => ({})),
  buildProjectTaskDependencyUnblockedPayload: vi.fn(() => ({})),
  buildProjectTaskStatusChangedPayload: vi.fn(() => ({})),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/tags/actions/tagActions', () => ({
  bulkApplyTagsToEntities: vi.fn(),
  findTagsByEntityIds: vi.fn(async () => []),
}));
vi.mock('@alga-psa/tags/actions/tagActionErrors', () => ({ isTagActionError: () => false }));
vi.mock('@alga-psa/validation', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  validateArray: (_schema: unknown, data: unknown) => data,
  validateData: (_schema: unknown, data: unknown) => data,
}));
vi.mock('@alga-psa/authorization/kernel', () => ({
  BuiltinAuthorizationKernelProvider: class {},
  BundleAuthorizationKernelProvider: class {
    constructor(_options: unknown) {}
  },
  RequestLocalAuthorizationCache: class {},
  createAuthorizationKernel: () => ({
    authorizeResource: async () => ({ allowed: true }),
  }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: async () => [],
}));

import { duplicateTaskToPhase } from './projectTaskActions';

describe('duplicateTaskToPhase ticket-link billing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockResolvedValue(true);
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    addTaskMock.mockResolvedValue({
      task_id: 'task-copy',
      phase_id: 'phase-2',
      task_name: 'Fix printer (Copy)',
      project_status_mapping_id: 'psm-1',
      assigned_to: null,
      due_date: null,
      created_at: new Date('2026-10-01T00:00:00.000Z'),
    });
    addTaskTicketLinkMock.mockResolvedValue({ link_id: 'copy-link' });
  });

  it('carries a reference-only link to the copy instead of making it billable', async () => {
    getTaskTicketLinksMock.mockResolvedValue([
      { link_id: 'link-1', ticket_id: 'ticket-1', bill_under_project: false },
      { link_id: 'link-2', ticket_id: 'ticket-2', bill_under_project: true },
    ]);

    await duplicateTaskToPhase('task-original', 'phase-2', { duplicateTicketLinks: true });

    expect(addTaskTicketLinkMock).toHaveBeenCalledTimes(2);
    expect(addTaskTicketLinkMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'tenant-1',
      'project-1',
      'task-copy',
      'ticket-1',
      'phase-2',
      false,
    );
    expect(addTaskTicketLinkMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'tenant-1',
      'project-1',
      'task-copy',
      'ticket-2',
      'phase-2',
      true,
    );
  });

  it('defaults a link saved before the column existed to project billing', async () => {
    getTaskTicketLinksMock.mockResolvedValue([
      { link_id: 'link-3', ticket_id: 'ticket-3' },
    ]);

    await duplicateTaskToPhase('task-original', 'phase-2', { duplicateTicketLinks: true });

    expect(addTaskTicketLinkMock).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'project-1',
      'task-copy',
      'ticket-3',
      'phase-2',
      true,
    );
  });
});
