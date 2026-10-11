import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;
let projectReadGranted: boolean;

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const hasPermissionMock = vi.fn();
const getPortalVisibilityForUserMock = vi.fn();
const applyProjectVisibilityFilterMock = vi.fn((query: any) => query);
const projectsTable = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (_conn: any, _tenant: string) => ({
    table: (table: string) => projectsTable(table),
    unscoped: (table: string) => projectsTable(table),
    tenantJoin: (query: any) => query,
  }),
}));

vi.mock('@alga-psa/authorization/portal/visibility', () => ({
  applyProjectVisibilityFilter: (...args: any[]) => applyProjectVisibilityFilterMock(...args),
}));

vi.mock('../../lib/clientAuth', () => ({
  getPortalVisibilityForUser: (...args: any[]) => getPortalVisibilityForUserMock(...args),
}));

function buildProjectQuery(rows: any[]) {
  const query: any = {};
  for (const key of ['select', 'where', 'andWhere', 'whereNull', 'orderBy', 'offset', 'limit', 'count', 'transacting']) {
    query[key] = vi.fn(() => query);
  }
  query.first = vi.fn(() => query);
  query.then = (resolve: any, reject: any) => Promise.resolve(rows[0]).then(resolve, reject);
  return query;
}

describe('client portal project actions enforce project:read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    currentUser = {
      user_id: 'portal-user-1',
      user_type: 'client',
      email: 'client@example.com',
      contact_id: 'contact-1',
      tenant: 'tenant-1',
    };
    projectReadGranted = false;

    createTenantKnexMock.mockResolvedValue({ knex: {} as any });
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback({} as any)
    );
    hasPermissionMock.mockImplementation(async () => projectReadGranted);
    getPortalVisibilityForUserMock.mockResolvedValue({ clientId: 'client-1', contactId: 'contact-1' });
    applyProjectVisibilityFilterMock.mockImplementation((query: any) => query);
    projectsTable.mockImplementation((table: string) => {
      throw new Error(`Unexpected table: ${table}`);
    });
  });

  it('getClientProjects fails closed without project:read', async () => {
    const { getClientProjects } = await import('./client-projects');

    const result = await getClientProjects();

    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'portal-user-1', user_type: 'client', tenant: 'tenant-1' }),
      'project',
      'read',
      expect.anything()
    );
    expect(result).toEqual({
      permissionError: 'Insufficient permissions to view projects',
      messageKey: 'common:errors.permissions.projects.read',
    });
    // The permission gate short-circuits before any project row is read.
    expect(projectsTable).not.toHaveBeenCalled();
    expect(applyProjectVisibilityFilterMock).not.toHaveBeenCalled();
  });

  it('getClientProjectDetails fails closed without project:read', async () => {
    const { getClientProjectDetails } = await import('./client-projects');

    const result = await getClientProjectDetails('project-1');

    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'portal-user-1', user_type: 'client', tenant: 'tenant-1' }),
      'project',
      'read',
      expect.anything()
    );
    expect(result).toEqual({
      permissionError: 'Insufficient permissions to view project details',
      messageKey: 'common:errors.permissions.projects.readDetails',
    });
    expect(projectsTable).not.toHaveBeenCalled();
    expect(applyProjectVisibilityFilterMock).not.toHaveBeenCalled();
  });

  it('getClientProjectDetails returns the project once project:read is granted', async () => {
    projectReadGranted = true;
    const project = { project_id: 'project-1', project_name: 'Rollout' };
    projectsTable.mockImplementation(() => buildProjectQuery([project]));

    const { getClientProjectDetails } = await import('./client-projects');

    const result = await getClientProjectDetails('project-1');

    expect(applyProjectVisibilityFilterMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clientId: 'client-1' }),
      { clientColumn: 'projects.client_id', contactColumn: 'projects.contact_name_id' }
    );
    expect(result).toEqual(project);
  });
});
