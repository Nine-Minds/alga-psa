/**
 * Authorization contract for the project task CSV export.
 *
 * The export dumps one project's tasks — names, assignees, dates, tags — so the
 * tenant-wide project:read gate is not enough on its own: the caller also has to
 * clear the record-level kernel decision for that project, the same one the task
 * actions apply. Without it a user restricted from a project could read it by
 * exporting it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionMock = vi.hoisted(() => vi.fn());
const createTenantKnexMock = vi.hoisted(() => vi.fn());
const withTransactionMock = vi.hoisted(() => vi.fn());
const authorizeResourceMock = vi.hoisted(() => vi.fn(async () => ({ allowed: true })));
const projectGetByIdMock = vi.hoisted(() => vi.fn(async () => ({ project_id: 'project-1' })));
const tableMock = vi.hoisted(() => vi.fn());

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
  withTransaction: withTransactionMock,
  tenantDb: () => ({
    table: (...args: unknown[]) => {
      tableMock(...args);
      return stubQuery();
    },
    // Callers use tenantJoin for its side effect on the passed query builder.
    tenantJoin: (query: any) => query,
  }),
}));

vi.mock('@shared/services/productAccessGuard', () => ({
  assertPsaOnlyTenantAccess: async () => undefined,
  ProductAccessError: class ProductAccessError extends Error {},
}));

vi.mock('@alga-psa/tags/actions/tagActions', () => ({ findTagsByEntityIds: vi.fn(async () => []) }));
vi.mock('@alga-psa/tags/actions/tagActionErrors', () => ({ isTagActionError: () => false }));
vi.mock('@alga-psa/projects/models/project', () => ({ default: { getById: projectGetByIdMock } }));
vi.mock('../models/project', () => ({ default: { getById: projectGetByIdMock } }));
vi.mock('@alga-psa/authorization/kernel', () => ({
  BuiltinAuthorizationKernelProvider: class {},
  BundleAuthorizationKernelProvider: class {
    constructor(_options: unknown) {}
  },
  RequestLocalAuthorizationCache: class {},
  createAuthorizationKernel: () => ({ authorizeResource: authorizeResourceMock }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: async () => [],
}));

import { exportProjectTasksToCSV } from './projectTaskExportActions';

beforeEach(() => {
  vi.clearAllMocks();
  createTenantKnexMock.mockResolvedValue({ knex: stubQuery(), tenant: 'tenant-1' });
  withTransactionMock.mockImplementation(async (_db: unknown, cb: any) => cb(stubQuery()));
  authorizeResourceMock.mockResolvedValue({ allowed: true });
  projectGetByIdMock.mockResolvedValue({ project_id: 'project-1' } as any);
});

describe('exportProjectTasksToCSV authorization', () => {
  it('refuses to export without project:read', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const result = await exportProjectTasksToCSV('project-1', ['phase-1']);

    expect(result).toEqual({ permissionError: 'Permission denied: Cannot read project' });
    expect(projectGetByIdMock).not.toHaveBeenCalled();
  });

  it('refuses to export a project the caller is restricted from', async () => {
    // Tenant-wide project:read, but bundle narrowing hides this project.
    hasPermissionMock.mockResolvedValue(true);
    authorizeResourceMock.mockResolvedValue({ allowed: false });

    const result = await exportProjectTasksToCSV('project-1', ['phase-1']);

    expect(result).toEqual({ permissionError: 'Permission denied: Cannot read project' });
    // No phase or task read happened on the way to the denial.
    expect(tableMock).not.toHaveBeenCalledWith('project_phases');
    expect(tableMock).not.toHaveBeenCalledWith('project_tasks');
  });

  it('reads the project tasks when the caller may read that project', async () => {
    hasPermissionMock.mockResolvedValue(true);
    authorizeResourceMock.mockResolvedValue({ allowed: true });

    const result = await exportProjectTasksToCSV('project-1', ['phase-1']);

    expect(authorizeResourceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({ type: 'project', action: 'read', id: 'project-1' }),
      }),
    );
    expect(tableMock).toHaveBeenCalledWith('project_phases');
    expect(result).not.toHaveProperty('permissionError');
  });

  it('reports a missing project instead of exporting', async () => {
    hasPermissionMock.mockResolvedValue(true);
    projectGetByIdMock.mockResolvedValue(null as any);

    const result = await exportProjectTasksToCSV('project-1', ['phase-1']);

    expect(result).toMatchObject({ actionError: 'Project not found' });
  });
});
