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
  getById: vi.fn(),
  getPhases: vi.fn(async () => [{ phase_id: 'phase1', project_id: 'p1', phase_name: 'Phase', wbs_code: '1' }]),
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
vi.mock('../models/project', () => ({ default: {
  getByIds: (...args: any[]) => state.getByIds(...args),
  getMaskedByIds: (...args: any[]) => state.getMaskedByIds(...args),
  getById: (...args: any[]) => state.getById(...args),
  getAll: async () => state.projectRows,
  getPhases: () => state.getPhases(),
  getProjectStatusMappings: async () => [{ project_status_mapping_id: 's1' }],
  getEffectiveStatusMappings: async () => [],
} }));
vi.mock('../models/projectTask', () => ({ default: {
  getTasks: async () => [], getAllTaskChecklistItems: async () => ({}),
  getAllTaskTicketLinks: async () => ({}), getAllTaskResources: async () => ({}),
} }));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({ getAllUsers: vi.fn(async () => []), findUserById: vi.fn() }));
vi.mock('@alga-psa/clients/actions/contact-actions/contactActions', () => ({ getContactByContactNameId: vi.fn() }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: Function) => (...args: any[]) => handler(state.user, { tenant: state.tenant }, ...args) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: (...args: any[]) => state.permission(...args) }));
vi.mock('@alga-psa/validation', () => ({ validateArray: vi.fn(), validateData: vi.fn() }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({ tenantJoin: vi.fn(), table: (name: string) => { state.queryTable(name); return queryFor(name === 'projects' ? state.projectRows : name === 'clients' ? state.clientRows : []); } }),
  withTransaction: async (_db: unknown, callback: (trx: unknown) => unknown) => callback({ raw: () => ({}) }),
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
vi.mock('./projectTaskActions', () => ({ filterAuthorizedTicketIds: vi.fn(async () => []) }));
vi.mock('../lib/taskTicketMapping', () => ({ applyTicketLinkRestriction: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/projectReadAuthorization', () => ({
  createProjectReadAuthorizer: async () => async (project: any) => state.projectDecisions.get(project.project_id)?.allowed ?? false,
  createProjectReadDecider: async () => async (project: any) => state.projectDecisions.get(project.project_id) ?? { allowed: false, redactedFields: [] },
  createClientReadDecider: async () => async (client: any) => state.clientDecisions.get(client.client_id) ?? { allowed: false, redactedFields: [] },
}));
vi.mock('@alga-psa/inventory/lib/staging', () => ({ countActiveStockClaims: vi.fn() }));

import { getAllClientsForProjects, getProjects, getProject, getProjectMetadata, getProjectDetails, getProjectsWithPhases, getProjectTreeData } from './projectActions';
import { coManagedProjectFamilyMask, coManagedHiddenColumns, CO_MANAGED_PROJECT_COLUMNS } from '@alga-psa/co-managed/projectFieldMask';

describe('project action authorization boundaries', () => {
  beforeEach(() => {
    state.projectRows = [];
    state.clientRows = [];
    state.projectDecisions.clear();
    state.clientDecisions.clear();
    state.permission.mockReset().mockResolvedValue(true);
    state.getByIds.mockReset();
    state.getById.mockReset();
    state.getPhases.mockClear();
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

  it.each([
    ['wildcard resource redaction', ['*']],
    ['prefixed client name redaction', ['fields.client_name']],
    ['client identifier redaction', ['client_id']],
  ])('getAllClientsForProjects applies %s before exposing picker data or logos', async (_caseName, redactedFields) => {
    state.clientRows = [{ client_id: 'c1', client_name: 'Acme', client_type: 'company', is_inactive: false }];
    state.clientDecisions.set('c1', { allowed: true, redactedFields });

    await expect(getAllClientsForProjects()).resolves.toEqual([]);
    expect(state.logoUrls).not.toHaveBeenCalled();
  });

  describe.each([
    ['getProject', () => getProject('p1'), 'row'],
    ['getProjectMetadata', () => getProjectMetadata('p1'), 'metadata'],
    ['getProjectDetails', () => getProjectDetails('p1'), 'metadata'],
    ['getProjectsWithPhases', () => getProjectsWithPhases(), 'picker'],
    ['getProjectTreeData by ID', () => getProjectTreeData('p1'), 'tree'],
    ['getProjectTreeData all', () => getProjectTreeData(), 'tree'],
  ] as const)('%s redaction boundary', (_name, read, shape) => {
    it.each([
      ['wildcard', ['*'], true],
      ['prefixed client name', ['fields.client_name'], true],
      ['client identifier', ['client_id'], true],
      ['project identifier', ['project_id'], true],
      ['prefixed project name', ['fields.project_name'], true],
      ['sensitive description', ['description'], true],
      ['record denial', [], false],
      ['unrestricted record', [], true],
    ] as Array<[string, string[], boolean]>)('honors %s', async (_case, fields, allowed) => {
      const raw = {
        project_id: 'p1', project_name: 'Secret project', client_id: 'c1', client_name: 'Secret client',
        description: 'Secret description', assigned_to: null, is_inactive: false,
      };
      state.projectRows = [raw];
      state.projectDecisions.set('p1', { allowed, redactedFields: [...fields] });
      state.getById.mockResolvedValue(raw);
      state.getByIds.mockResolvedValue([raw]);
      // Model boundary double uses the production mask vocabulary; the action must select this
      // loader with the decision's fields rather than returning the raw identity/model record.
      state.getMaskedByIds.mockImplementation(async (_trx, _tenant, _ids, redactions) => {
        const mask = coManagedProjectFamilyMask(redactions, 'project');
        if (mask.dropRow) return [];
        const hidden = coManagedHiddenColumns(redactions, 'projects', CO_MANAGED_PROJECT_COLUMNS);
        return [{ ...raw,
          project_name: mask.title ? mask.neutralTitle : raw.project_name,
          description: mask.body ? null : raw.description,
          client_id: hidden.has('client_id') ? null : raw.client_id,
          client_name: hidden.has('client_name') ? null : raw.client_name,
        }];
      });

      const result = await read();
      const omitted = !allowed || fields.includes('*') || fields.includes('project_id');
      if (omitted) {
        expect(result).toEqual(shape === 'metadata'
          ? { permissionError: 'Permission denied: Cannot read project' }
          : shape === 'row' ? null : []);
        expect(state.getPhases).not.toHaveBeenCalled();
      } else if (shape === 'row' || shape === 'metadata') {
        const project = shape === 'metadata' ? (result as any).project : result;
        expect(project).toMatchObject({
          project_id: 'p1',
          project_name: fields.includes('fields.project_name') ? 'Project' : raw.project_name,
          description: fields.includes('description') ? null : raw.description,
          client_id: fields.includes('client_id') ? null : raw.client_id,
          client_name: fields.includes('client_id') || fields.includes('fields.client_name') ? null : raw.client_name,
        });
      } else {
        expect(result).toMatchObject([shape === 'tree'
          ? { label: fields.includes('fields.project_name') ? 'Project' : raw.project_name, value: 'p1' }
          : { project_name: fields.includes('fields.project_name') ? 'Project' : raw.project_name, project_id: 'p1' }]);
      }
      if (allowed && fields.length) {
        expect(state.getMaskedByIds).toHaveBeenCalledWith(expect.anything(), 't1', ['p1'], [...fields]);
        expect(state.getByIds).not.toHaveBeenCalled();
      }
    });
  });

});
