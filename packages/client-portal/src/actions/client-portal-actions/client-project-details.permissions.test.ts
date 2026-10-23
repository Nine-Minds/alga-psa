import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;
let projectReadGranted: boolean;

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const hasPermissionMock = vi.fn();
const getPortalVisibilityForUserMock = vi.fn();
const applyProjectVisibilityFilterMock = vi.fn((query: any) => query);
const tableMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (_conn: any, _tenant: string) => ({
    table: (table: string) => tableMock(table),
    unscoped: (table: string) => tableMock(table),
    tenantJoin: (query: any) => query,
  }),
}));

vi.mock('@alga-psa/authorization/portal/visibility', () => ({
  applyProjectVisibilityFilter: (...args: any[]) => applyProjectVisibilityFilterMock(...args),
}));

vi.mock('../../lib/clientAuth', () => ({
  getPortalVisibilityForUser: (...args: any[]) => getPortalVisibilityForUserMock(...args),
}));

vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: { validateFileUpload: vi.fn(), uploadFile: vi.fn() },
}));

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getEntityImageUrlsBatch: vi.fn(async () => new Map()),
}));

function buildQuery(rows: any[]) {
  const query: any = {};
  for (const key of ['select', 'where', 'andWhere', 'whereIn', 'whereNull', 'whereRaw', 'orderBy', 'orderByRaw', 'groupBy', 'limit']) {
    query[key] = vi.fn(() => query);
  }
  query.first = vi.fn(async () => rows[0]);
  query.then = (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject);
  return query;
}

describe('client portal project detail actions enforce project:read', () => {
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

    createTenantKnexMock.mockResolvedValue({ knex: { raw: vi.fn() } as any });
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback({} as any)
    );
    hasPermissionMock.mockImplementation(async () => projectReadGranted);
    getPortalVisibilityForUserMock.mockResolvedValue({ clientId: 'client-1', contactId: 'contact-1' });
    applyProjectVisibilityFilterMock.mockImplementation((query: any) => query);
    tableMock.mockImplementation((table: string) => {
      throw new Error(`Unexpected table: ${table}`);
    });
  });

  it('getClientProjectPhases reads nothing without project:read', async () => {
    const { getClientProjectPhases } = await import('./client-project-details');

    const result = await getClientProjectPhases('project-1');

    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'portal-user-1', user_type: 'client', tenant: 'tenant-1' }),
      'project',
      'read',
      expect.anything()
    );
    expect(result).toBeNull();
    expect(getPortalVisibilityForUserMock).not.toHaveBeenCalled();
    expect(tableMock).not.toHaveBeenCalled();
  });

  it('getClientProjectTasks reads nothing without project:read', async () => {
    const { getClientProjectTasks } = await import('./client-project-details');

    expect(await getClientProjectTasks('project-1')).toBeNull();
    expect(tableMock).not.toHaveBeenCalled();
  });

  it('getClientProjectStatuses reads nothing without project:read', async () => {
    const { getClientProjectStatuses } = await import('./client-project-details');

    expect(await getClientProjectStatuses('project-1')).toBeNull();
    expect(tableMock).not.toHaveBeenCalled();
  });

  it('getClientTaskDocuments refuses without project:read', async () => {
    const { getClientTaskDocuments } = await import('./client-project-details');

    expect(await getClientTaskDocuments('task-1')).toEqual({ success: false, error: 'Not authorized' });
    expect(tableMock).not.toHaveBeenCalled();
  });

  it('uploadClientTaskDocument refuses without project:read', async () => {
    const { uploadClientTaskDocument } = await import('./client-project-details');

    const result = await uploadClientTaskDocument('task-1', new FormData());

    expect(result).toEqual({ success: false, error: 'Not authorized' });
    expect(tableMock).not.toHaveBeenCalled();
  });

  it('getClientProjectPhases loads phases once project:read is granted', async () => {
    projectReadGranted = true;
    const phases = [{ phase_id: 'phase-1', order_key: 'a' }];
    tableMock.mockImplementation((table: string) => {
      if (table === 'projects') {
        return buildQuery([{ project_id: 'project-1', client_portal_config: { show_phases: true } }]);
      }
      if (table === 'project_phases') {
        return buildQuery(phases);
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const { getClientProjectPhases } = await import('./client-project-details');

    expect(await getClientProjectPhases('project-1')).toEqual({ phases });
  });
});
