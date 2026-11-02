import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorizeResource: vi.fn(),
  getByIds: vi.fn(),
  getMaskedByIds: vi.fn(),
  table: vi.fn(),
  getAllUsers: vi.fn(),
  getAllTaskChecklistItems: vi.fn(),
  getAllTaskTicketLinks: vi.fn(),
  getAllTaskResources: vi.fn(),
}));

function queryFor(tableName: string): any {
  let selected: any[] = [];
  const rows = () => {
    if (tableName === 'projects') return [{ project_id: 'redacted-project', assigned_to: null, client_id: 'client-1' }];
    if (tableName === 'project_phases') {
      const row: any = { tenant: 'tenant-1', phase_id: 'phase-1', project_id: 'redacted-project', phase_name: 'Secret phase', description: 'Secret phase description', wbs_code: '1.1' };
      for (const column of selected.flat()) {
        if (column && typeof column === 'object' && typeof column.sql === 'string') {
          const alias = column.args?.[1] as string | undefined ?? column.sql.match(/as "?([a-z_]+)"?/i)?.[1] ?? column.args?.[0] as string | undefined;
          if (alias) row[alias] = column.sql.includes('?::text') ? column.args?.[0] : null;
        }
      }
      return [row];
    }
    if (tableName === 'project_tasks') {
      const row: any = { tenant: 'tenant-1', task_id: 'task-1', phase_id: 'phase-1', project_id: 'redacted-project', task_name: 'Secret task', description: 'Secret task description', wbs_code: '1.1' };
      for (const column of selected.flat()) {
        if (column && typeof column === 'object' && typeof column.sql === 'string') {
          const alias = column.args?.[1] as string | undefined ?? column.sql.match(/as "?([a-z_]+)"?/i)?.[1] ?? column.args?.[0] as string | undefined;
          if (alias) row[alias] = column.sql.includes('?::text') ? column.args?.[0] : null;
        }
      }
      return [row];
    }
    return [];
  };
  const builder: any = new Proxy({}, {
    get(_target, property) {
      if (property === 'then') return (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(rows()).then(resolve, reject);
      if (property === 'first') return async () => undefined;
      if (property === 'select') return (...columns: any[]) => { selected = columns; return builder; };
      return () => builder;
    },
  });
  return builder;
}

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(
    { user_id: 'user-1', user_type: 'internal', roles: [{ role_id: 'role-1' }] },
    { tenant: 'tenant-1' },
    ...args,
  ),
  withOptionalAuth: (action: any) => action,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_db: unknown, callback: (trx: unknown) => unknown) => callback({ raw: (sql: string, args?: unknown[]) => ({ sql, args }) }),
  tenantDb: () => ({
    table: (name: string) => { mocks.table(name); return queryFor(name); },
    tenantJoin: (query: unknown) => query,
  }),
  registerAfterCommit: vi.fn(),
}));
vi.mock('@alga-psa/authorization/kernel', () => ({
  BuiltinAuthorizationKernelProvider: class {},
  BundleAuthorizationKernelProvider: class {},
  RequestLocalAuthorizationCache: class {},
  createAuthorizationKernel: () => ({ authorizeResource: mocks.authorizeResource }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({ resolveBundleNarrowingRulesForEvaluation: async () => [] }));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getAllUsers: mocks.getAllUsers,
  findUserById: vi.fn(async () => null),
}));
vi.mock('../models/project', () => ({ default: {
  getByIds: mocks.getByIds,
  getMaskedByIds: mocks.getMaskedByIds,
  getPhases: vi.fn(),
  getProjectStatusMappings: vi.fn(),
  getStandardStatusesByType: vi.fn(async () => []),
  addProjectStatusMapping: vi.fn(),
} }));
vi.mock('../models/projectTask', () => ({ default: {
  getAllTaskChecklistItems: mocks.getAllTaskChecklistItems,
  getAllTaskTicketLinks: mocks.getAllTaskTicketLinks,
  getAllTaskResources: mocks.getAllTaskResources,
} }));

import { getProject, getProjects, getProjectsWithPhases, getProjectTreeData, getProjectMetadata, getProjectDetails } from './projectActions';

const projectRedactions = ['description', 'client_name', 'manager_name', 'contact_name_id', 'body', 'task_name', 'status', 'phase_name', 'project_phases.wbs_code'];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeResource.mockResolvedValue({ allowed: true, redactedFields: projectRedactions });
  mocks.getMaskedByIds.mockResolvedValue([{
    project_id: 'redacted-project', project_name: 'Restricted project', description: null, client_name: null,
    contact_name: null, contact_name_id: null, assigned_to: null, is_inactive: false,
  }]);
  mocks.getByIds.mockResolvedValue([{
    project_id: 'redacted-project', project_name: 'Restricted project', description: 'Protected description', client_name: 'Protected client',
  }]);
});

describe('ordinary project action field redaction', () => {
  it('does not return protected project or client metadata for an allowed redacted detail read', async () => {
    await expect(getProject('redacted-project')).resolves.toMatchObject({
      project_id: 'redacted-project',
      project_name: 'Restricted project',
      description: null,
      client_name: null,
    });
    expect(mocks.getMaskedByIds).toHaveBeenCalledWith(expect.anything(), 'tenant-1', ['redacted-project'], expect.arrayContaining(['client_name', 'description']));
    expect(mocks.getByIds).not.toHaveBeenCalled();
  });

  it('does not fetch a resource projection after a deny decision', async () => {
    mocks.authorizeResource.mockResolvedValue({ allowed: false, redactedFields: [] });
    await expect(getProject('redacted-project')).resolves.toBeNull();
    expect(mocks.getByIds).not.toHaveBeenCalled();
    expect(mocks.getMaskedByIds).not.toHaveBeenCalled();
  });

  it('redacts list rows through the shared loader and omits denied projects', async () => {
    const rows = await getProjects();
    expect(rows).toEqual([expect.objectContaining({ description: null, client_name: null })]);
    mocks.authorizeResource.mockResolvedValue({ allowed: false, redactedFields: [] });
    mocks.getMaskedByIds.mockClear();
    await expect(getProjects()).resolves.toEqual([]);
    expect(mocks.getMaskedByIds).not.toHaveBeenCalled();
  });

  it('returns masked phase title and WBS in the project picker', async () => {
    const rows = await getProjectsWithPhases();
    expect(rows).toMatchObject([{
      project_id: 'redacted-project',
      phases: [{ phase_id: 'phase-1', phase_name: 'Project phase', wbs_code: null, statuses: [] }],
    }]);
  });

  it('returns masked phase labels and no redacted status identifiers in the tree', async () => {
    const rows = await getProjectTreeData();
    expect(rows).toMatchObject([{
      label: 'Restricted project',
      children: [{ label: 'Project phase', value: 'phase-1', children: [] }],
    }]);
  });

  it('omits phase and status rows when their emitted identifiers are redacted', async () => {
    mocks.authorizeResource.mockResolvedValue({ allowed: true, redactedFields: ['phase_id'] });
    await expect(getProjectsWithPhases()).resolves.toMatchObject([{ phases: [] }]);
    await expect(getProjectTreeData()).resolves.toEqual([]);

    mocks.authorizeResource.mockResolvedValue({ allowed: true, redactedFields: ['mapping_id'] });
    await expect(getProjectsWithPhases()).resolves.toMatchObject([{ phases: [{ statuses: [] }] }]);
  });

  it('masks phase body and suppresses redacted contact, assignee, client, and status metadata', async () => {
    const result = await getProjectMetadata('redacted-project');
    expect(result).toMatchObject({
      project: { description: null, contact_name: null, assigned_to: null, client_name: null },
      phases: [{ phase_name: 'Project phase', description: null, wbs_code: null }],
      statuses: [], users: [], clients: [], assignedUser: null,
    });
    expect(result).toHaveProperty('contact', undefined);
  });

  it('masks project and task fields in the details response without fetching unmasked task metadata', async () => {
    const result = await getProjectDetails('redacted-project');
    expect(result).toMatchObject({
      project: { description: null, contact_name: null, assigned_to: null, client_name: null },
      phases: [{ phase_name: 'Project phase', description: null, wbs_code: null }],
      tasks: [{ task_name: 'Project task', description: null }],
      ticketLinks: [], statuses: [], users: [], clients: [], assignedUser: null,
    });
    expect(mocks.getAllTaskChecklistItems).not.toHaveBeenCalled();
    expect(mocks.getAllTaskTicketLinks).not.toHaveBeenCalled();
    expect(mocks.getAllTaskResources).not.toHaveBeenCalled();
  });
});
