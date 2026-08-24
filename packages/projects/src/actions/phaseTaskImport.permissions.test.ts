/**
 * Authorization contract for the project phase/task CSV importer.
 *
 * The importer writes phases and tasks, and can also seed the tenant's shared
 * status library. The reference-data loader that feeds its mapping UI returns
 * the tenant's internal user directory, so it needs a read gate of its own.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionMock = vi.hoisted(() => vi.fn());
const createTenantKnexMock = vi.hoisted(() => vi.fn());
const withTransactionMock = vi.hoisted(() => vi.fn());
const getAllUsersBasicMock = vi.hoisted(() => vi.fn(async () => []));
const getAllPrioritiesMock = vi.hoisted(() => vi.fn(async () => []));
const getServicesMock = vi.hoisted(() => vi.fn(async () => []));
const projectGetByIdMock = vi.hoisted(() => vi.fn(async () => ({ project_id: 'project-1' })));
const getProjectStatusMappingsMock = vi.hoisted(() => vi.fn(async () => [
  { project_status_mapping_id: 'psm-1', custom_name: 'Open', status_name: 'Open', name: 'Open' },
]));
const getPhasesMock = vi.hoisted(() => vi.fn(async () => []));

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
    // Callers use tenantJoin for its side effect on the passed query builder.
    tenantJoin: (query: any) => query,
  }),
}));

vi.mock('@alga-psa/shared/db', () => ({ withTransaction: withTransactionMock }));
vi.mock('@alga-psa/core', () => ({ unparseCSV: vi.fn(() => '') }));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getAllUsersBasic: getAllUsersBasicMock,
}));
vi.mock('@alga-psa/reference-data/actions/priorityActions', () => ({
  getAllPriorities: getAllPrioritiesMock,
}));
vi.mock('./serviceCatalogActions', () => ({ getServices: getServicesMock }));
vi.mock('@alga-psa/tags/actions/tagActions', () => ({
  createTagsForEntityWithTransaction: vi.fn(),
}));
vi.mock('@alga-psa/projects/models/project', () => ({
  default: {
    getById: projectGetByIdMock,
    getProjectStatusMappings: getProjectStatusMappingsMock,
    getPhases: getPhasesMock,
  },
}));
vi.mock('../models/projectTask', () => ({ default: { addTask: vi.fn() } }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/workflow-streams', () => ({
  buildProjectTaskAssignedPayload: vi.fn(),
  buildProjectTaskCreatedPayload: vi.fn(),
}));

import { getImportReferenceData, importPhasesAndTasks } from './phaseTaskImportActions';

beforeEach(() => {
  vi.clearAllMocks();
  createTenantKnexMock.mockResolvedValue({ knex: {}, tenant: 'tenant-1' });
  withTransactionMock.mockImplementation(async (_db: unknown, cb: any) => cb(stubQuery()));
  getAllUsersBasicMock.mockResolvedValue([]);
  getAllPrioritiesMock.mockResolvedValue([]);
  getServicesMock.mockResolvedValue([]);
  projectGetByIdMock.mockResolvedValue({ project_id: 'project-1' } as any);
  getProjectStatusMappingsMock.mockResolvedValue([
    { project_status_mapping_id: 'psm-1', custom_name: 'Open', status_name: 'Open', name: 'Open' },
  ] as any);
  getPhasesMock.mockResolvedValue([]);
});

describe('importPhasesAndTasks authorization', () => {
  it('refuses to import without project:update', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const result = await importPhasesAndTasks('project-1', []);

    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toMatch(/permission/i);
  });

  it('checks the permission before reading the project', async () => {
    hasPermissionMock.mockResolvedValue(false);

    await importPhasesAndTasks('project-1', []).catch(() => undefined);

    expect(hasPermissionMock).toHaveBeenCalledWith(expect.anything(), 'project', 'update');
    expect(projectGetByIdMock).not.toHaveBeenCalled();
  });

  it('proceeds past the gate when project:update is granted', async () => {
    hasPermissionMock.mockResolvedValue(true);

    await importPhasesAndTasks('project-1', []).catch(() => undefined);

    expect(projectGetByIdMock).toHaveBeenCalled();
  });
});

describe('getImportReferenceData authorization', () => {
  it('requires project:read before returning tenant reference data', async () => {
    // Returns every active internal user with their email address, plus the
    // tenant's priorities, services and statuses. Authentication alone must not
    // be enough to enumerate the staff directory.
    hasPermissionMock.mockResolvedValue(false);

    await expect(getImportReferenceData('project-1')).rejects.toThrow(/permission/i);
  });

  it('does not touch the database when the caller is denied', async () => {
    hasPermissionMock.mockResolvedValue(false);

    await getImportReferenceData('project-1').catch(() => undefined);

    expect(hasPermissionMock).toHaveBeenCalledWith(expect.anything(), 'project', 'read');
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('returns reference data when project:read is granted', async () => {
    hasPermissionMock.mockResolvedValue(true);

    const result = await getImportReferenceData('project-1');

    expect(result).toBeDefined();
    expect(createTenantKnexMock).toHaveBeenCalled();
  });
});
