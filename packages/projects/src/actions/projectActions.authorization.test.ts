import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { user_id: 'u1', user_type: 'internal', roles: [] },
  tenant: 't1',
  projectRows: [] as any[],
  clientRows: [] as any[],
  projectDecisions: new Map<string, { allowed: boolean; redactedFields: string[] }>(),
  clientDecisions: new Map<string, { allowed: boolean; redactedFields: string[] }>(),
  permission: vi.fn(async (..._args: any[]) => true),
  projectRead: vi.fn(),
  clientRead: vi.fn(),
  getByIds: vi.fn(),
  getMaskedByIds: vi.fn(),
  queryTable: vi.fn(),
  logoUrls: vi.fn(async (..._args: any[]) => new Map()),
}));

function queryFor(rows: any[]) {
  const query: any = {
    select: () => query,
    orderBy: () => query,
    whereIn: () => query,
    where: () => query,
    first: async () => rows[0],
    then: (resolve: (value: any[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
  };
  return query;
}

vi.mock('@alga-psa/types', () => ({ isMspPrincipalUserType: () => false }));
vi.mock('../models/project', () => ({ default: { getByIds: (...args: any[]) => state.getByIds(...args), getMaskedByIds: (...args: any[]) => state.getMaskedByIds(...args) } }));
vi.mock('../models/projectTask', () => ({ default: {} }));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({ getAllUsers: vi.fn(), findUserById: vi.fn() }));
vi.mock('@alga-psa/clients/actions/contact-actions/contactActions', () => ({ getContactByContactNameId: vi.fn() }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: Function) => (...args: any[]) => handler(state.user, { tenant: state.tenant }, ...args) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: (...args: any[]) => state.permission(...args) }));
vi.mock('@alga-psa/validation', () => ({ validateArray: vi.fn(), validateData: vi.fn() }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({ table: (name: string) => { state.queryTable(name); return queryFor(name === 'projects' ? state.projectRows : state.clientRows); } }),
  withTransaction: async (_db: unknown, callback: (trx: unknown) => unknown) => callback({}),
  registerAfterCommit: vi.fn(),
}));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({ getClientLogoUrlsBatch: (...args: any[]) => state.logoUrls(...args) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn() }));
vi.mock('../schemas/project.schemas', () => ({ createProjectSchema: {}, updateProjectSchema: {}, projectPhaseSchema: {} }));
vi.mock('../lib/orderingUtils', () => ({ OrderingService: class {} }));
vi.mock('../services/projectOrderingService', () => ({ regeneratePhaseOrderKeys: vi.fn() }));
vi.mock('../lib/kanbanPreferences', () => ({ projectKanbanHiddenStatusesKey: vi.fn() }));
vi.mock('@shared/services/numberingService', () => ({ SharedNumberingService: class {} }));
vi.mock('@alga-psa/workflow-streams', () => ({
  buildProjectBillingSchedulePayload: vi.fn(), buildProjectMilestoneReadyPayload: vi.fn(), buildProjectCreatedPayload: vi.fn(),
  buildProjectStatusChangedPayload: vi.fn(), buildProjectUpdatedPayload: vi.fn(), buildProjectAssignedPayload: vi.fn(), buildProjectClosedPayload: vi.fn(),
}));
vi.mock('@alga-psa/core/server', () => ({ deleteEntityWithValidation: vi.fn() }));
vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({ deleteEntityTags: vi.fn(), deleteEntitiesTags: vi.fn() }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  actionError: (message: string) => ({ actionError: message }),
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
  permissionError: (message: string) => ({ permissionError: message }),
}));
vi.mock('@alga-psa/tags/models/tagMapping', () => ({ default: {} }));
vi.mock('./projectTaskActions', () => ({ filterAuthorizedTicketIds: vi.fn() }));
vi.mock('../lib/taskTicketMapping', () => ({ applyTicketLinkRestriction: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/projectReadAuthorization', () => ({
  createProjectReadAuthorizer: vi.fn(),
  createProjectReadDecider: async () => async (project: any) => state.projectDecisions.get(project.project_id) ?? { allowed: false, redactedFields: [] },
  createClientReadDecider: async () => async (client: any) => state.clientDecisions.get(client.client_id) ?? { allowed: false, redactedFields: [] },
}));
vi.mock('@alga-psa/inventory/lib/staging', () => ({ countActiveStockClaims: vi.fn() }));

import { getAllClientsForProjects, getProjects } from './projectActions';

describe('project action authorization boundaries', () => {
  beforeEach(() => {
    state.projectRows = [];
    state.clientRows = [];
    state.projectDecisions.clear();
    state.clientDecisions.clear();
    state.permission.mockReset().mockResolvedValue(true);
    state.getByIds.mockReset();
    state.getMaskedByIds.mockReset();
    state.queryTable.mockReset();
    state.logoUrls.mockReset().mockResolvedValue(new Map());
    state.user = { user_id: 'u1', user_type: 'internal', roles: [] };
  });

  it('getProjects honors coarse permission denial at the exported action boundary', async () => {
    state.permission.mockResolvedValue(false);
    await expect(getProjects()).resolves.toEqual({ permissionError: 'Permission denied: Cannot read project' });
    expect(state.queryTable).not.toHaveBeenCalled();
    expect(state.getByIds).not.toHaveBeenCalled();
  });

  it('getProjects omits record-denied rows and returns masked fields for authorized rows', async () => {
    state.projectRows = [
      { project_id: 'p1', assigned_to: null, client_id: 'c1' },
      { project_id: 'p2', assigned_to: null, client_id: 'c2' },
    ];
    state.projectDecisions.set('p1', { allowed: true, redactedFields: ['description'] });
    state.projectDecisions.set('p2', { allowed: false, redactedFields: [] });
    state.getMaskedByIds.mockImplementation(async (_trx, _tenant, ids: string[], fields: string[]) => ids.map((project_id) => ({
      project_id, project_name: 'Allowed', description: fields.includes('description') ? null : 'secret', budgeted_hours: 8,
    })));

    await expect(getProjects()).resolves.toEqual([{ project_id: 'p1', project_name: 'Allowed', description: null, budgeted_hours: 8 }]);
    expect(state.getByIds).not.toHaveBeenCalled();
    expect(state.getMaskedByIds).toHaveBeenCalledWith(expect.anything(), 't1', ['p1'], ['description']);
  });

  it('getAllClientsForProjects denies coarse permission and record access at the exported boundary', async () => {
    state.permission.mockResolvedValue(false);
    await expect(getAllClientsForProjects()).resolves.toEqual([]);
    expect(state.queryTable).not.toHaveBeenCalled();

    state.permission.mockResolvedValue(true);
    state.clientRows = [{ client_id: 'c1', client_name: 'Acme', client_type: 'company', is_inactive: false }];
    state.clientDecisions.set('c1', { allowed: false, redactedFields: [] });
    await expect(getAllClientsForProjects()).resolves.toEqual([]);
  });

  it('getAllClientsForProjects masks returned picker fields and omits clients whose names are redacted', async () => {
    state.clientRows = [
      { client_id: 'c1', client_name: 'Acme', client_type: 'company', is_inactive: false },
      { client_id: 'c2', client_name: 'Hidden', client_type: 'company', is_inactive: false },
    ];
    state.clientDecisions.set('c1', { allowed: true, redactedFields: ['client_type'] });
    state.clientDecisions.set('c2', { allowed: true, redactedFields: ['client_name'] });

    await expect(getAllClientsForProjects()).resolves.toEqual([{
      client_id: 'c1', client_name: 'Acme', client_type: null, is_inactive: false, logoUrl: null,
    }]);
    expect(state.logoUrls).toHaveBeenCalledWith(['c1'], 't1');
  });
});
