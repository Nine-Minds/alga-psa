import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { user_id: 'u1', user_type: 'internal', roles: [] },
  tenant: 't1',
  projectRows: [] as any[],
  clientRows: [] as any[],
  quickViewClient: null as any,
  projectDecisions: new Map<string, { allowed: boolean; redactedFields: string[] }>(),
  clientDecisions: new Map<string, { allowed: boolean; redactedFields: string[] }>(),
  permission: vi.fn(async (..._args: any[]) => true),
  projectRead: vi.fn(),
  clientRead: vi.fn(),
  getByIds: vi.fn(),
  getById: vi.fn(),
  getQuickViewClient: vi.fn(),
  updateQuickViewClient: vi.fn(),
  locationRows: [] as any[],
  updateQuickViewLocation: vi.fn(),
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
vi.mock('@alga-psa/clients/actions/queryActions', () => ({ getClientById: (...args: any[]) => state.getQuickViewClient(...args) }));
vi.mock('@alga-psa/clients/actions/clientActions', () => ({ updateClient: (...args: any[]) => state.updateQuickViewClient(...args) }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: Function) => (...args: any[]) => handler(state.user, { tenant: state.tenant }, ...args) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: (...args: any[]) => state.permission(...args) }));
vi.mock('@alga-psa/validation', () => ({ validateArray: vi.fn(), validateData: vi.fn() }));
vi.mock('@alga-psa/clients/actions/clientLocationActions', () => ({
  updateClientLocation: (...args: any[]) => state.updateQuickViewLocation(...args),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({ tenantJoin: vi.fn(), table: (name: string) => { state.queryTable(name); return queryFor(name === 'projects' ? state.projectRows : name === 'clients' ? state.clientRows : name === 'client_locations' ? state.locationRows : []); } }),
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

import { getAllClientsForProjects, getProjectClientQuickView, getProjectClientLocationsQuickView, updateProjectClientLocationQuickView, updateProjectClientQuickView, getProjects, getProject, getProjectMetadata, getProjectDetails, getProjectsWithPhases, getProjectTreeData } from './projectActions';
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
    state.getQuickViewClient.mockReset();
    state.updateQuickViewClient.mockReset();
    state.locationRows = [];
    state.updateQuickViewLocation.mockReset();
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

  it('getProjectClientQuickView restores detailed data only after coarse and record authorization, then masks fields', async () => {
    state.clientRows = [{ client_id: 'c1' }];
    state.clientDecisions.set('c1', { allowed: true, redactedFields: ['fields.phone_no', 'fields.email', 'client_name'] });
    state.getQuickViewClient.mockResolvedValue({
      client_id: 'c1', client_name: 'Acme', phone_no: '555-0100', location_email: 'secret@example.test',
      logoUrl: '/logo.png', logoWideUrl: '/wide.png',
    });

    await expect(getProjectClientQuickView('c1')).resolves.toEqual({
      client_id: 'c1', client_name: null, phone_no: null, location_email: null, logoUrl: null, logoWideUrl: null,
    });
    expect(state.permission).toHaveBeenCalledWith(state.user, 'client', 'read', expect.anything());
    expect(state.getQuickViewClient).toHaveBeenCalledWith('c1');
  });

  it('getProjectClientQuickView rejects coarse and record denial before loading details, including direct action calls', async () => {
    state.permission.mockResolvedValue(false);
    await expect(getProjectClientQuickView('c1')).rejects.toThrow('Permission denied: Cannot read clients');
    expect(state.queryTable).not.toHaveBeenCalled();
    expect(state.getQuickViewClient).not.toHaveBeenCalled();

    state.permission.mockResolvedValue(true);
    state.clientRows = [{ client_id: 'c1' }];
    state.clientDecisions.set('c1', { allowed: false, redactedFields: [] });
    await expect(getProjectClientQuickView('c1')).rejects.toThrow('Permission denied: Cannot read clients');
    expect(state.getQuickViewClient).not.toHaveBeenCalled();
  });

  it.each([
    ['client identifier', ['fields.client_id']],
    ['client resource', ['clients']],
    ['wildcard', ['*']],
  ])('getProjectClientQuickView rejects details when the %s is hidden', async (_label, redactedFields) => {
    state.clientRows = [{ client_id: 'c1' }];
    state.clientDecisions.set('c1', { allowed: true, redactedFields });
    await expect(getProjectClientQuickView('c1')).rejects.toThrow('Permission denied: Cannot read clients');
    expect(state.getQuickViewClient).not.toHaveBeenCalled();
  });

  it('does not reconstruct a project-redacted client name through direct quick-view loader invocation', async () => {
    state.projectRows = [{ project_id: 'p1', assigned_to: null, client_id: 'c1' }];
    state.clientRows = [{ client_id: 'c1' }];
    state.projectDecisions.set('p1', { allowed: true, redactedFields: ['fields.client_name'] });
    state.getMaskedByIds.mockImplementation(async (_trx, _tenant, ids: string[], fields: string[]) => ids.map((project_id) => ({
      project_id, client_id: 'c1', client_name: fields.some((field) => field.includes('client_name')) ? null : 'Acme',
    })));

    await expect(getProjectClientQuickView('c1', 'p1')).rejects.toThrow('Permission denied: Cannot read project client');
    expect(state.getQuickViewClient).not.toHaveBeenCalled();
  });

  it('preserves hidden and omitted billing fields and returns a masked row after a visible-field edit', async () => {
    state.clientRows = [{ client_id: 'c1', billing_contact_id: 'billing-1', billing_email: 'billing@example.test' }];
    state.clientDecisions.set('c1', { allowed: true, redactedFields: ['fields.tax_id_number', 'fields.billing_email'] });
    state.getQuickViewClient.mockResolvedValue({
      client_id: 'c1', client_name: 'Changed name', tax_id_number: 'SECRET-TAX', billing_email: 'SECRET-BILLING',
      billing_contact_id: 'billing-1', properties: {},
    });
    state.updateQuickViewClient.mockResolvedValue({
      client_id: 'c1', client_name: 'Changed name', tax_id_number: 'SECRET-TAX', billing_email: 'SECRET-BILLING',
    });

    const result = await updateProjectClientQuickView('c1', {
      client_name: 'Changed name', tax_id_number: null, billing_email: null,
    });

    expect(state.updateQuickViewClient).toHaveBeenCalledWith('c1', expect.objectContaining({
      client_name: 'Changed name',
      billing_contact_id: 'billing-1',
      billing_email: 'billing@example.test',
    }));
    const submittedPatch = state.updateQuickViewClient.mock.calls[0][1];
    expect(submittedPatch).not.toHaveProperty('tax_id_number');
    expect(submittedPatch.billing_email).toBe('billing@example.test');
    expect(result).toMatchObject({ client_id: 'c1', client_name: 'Changed name', tax_id_number: null, billing_email: null });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('requires client:update before the quick-view mutation runs', async () => {
    state.permission.mockImplementation(async (_user: unknown, resource: string, action: string) =>
      resource !== 'client' || action !== 'update');

    await expect(updateProjectClientQuickView('c1', { client_name: 'Changed name' }))
      .rejects.toThrow('Permission denied: Cannot update clients');
    expect(state.updateQuickViewClient).not.toHaveBeenCalled();
  });

  it('requires client-record read authorization before the quick-view mutation runs', async () => {
    state.clientRows = [{ client_id: 'c1', billing_contact_id: null, billing_email: null }];
    state.clientDecisions.set('c1', { allowed: false, redactedFields: [] });

    await expect(updateProjectClientQuickView('c1', { client_name: 'Changed name' }))
      .rejects.toThrow('Permission denied: Cannot read clients');
    expect(state.updateQuickViewClient).not.toHaveBeenCalled();
  });

  it('does not mutate through a project whose client name is redacted', async () => {
    state.projectRows = [{ project_id: 'p1', assigned_to: null, client_id: 'c1' }];
    state.clientRows = [{ client_id: 'c1', billing_contact_id: null, billing_email: null }];
    state.projectDecisions.set('p1', { allowed: true, redactedFields: ['fields.client_name'] });
    state.getMaskedByIds.mockImplementation(async (_trx, _tenant, ids: string[]) => ids.map((project_id) => ({
      project_id, client_id: 'c1', client_name: null,
    })));

    await expect(updateProjectClientQuickView('c1', { client_name: 'Changed name' }, 'p1'))
      .rejects.toThrow('Permission denied: Cannot read project client');
    expect(state.updateQuickViewClient).not.toHaveBeenCalled();
  });

  it('loads masked location rows only after client-record and source-project authorization', async () => {
    state.projectRows = [{ project_id: 'p1', assigned_to: null, client_id: 'c1' }];
    state.clientRows = [{ client_id: 'c1' }];
    state.projectDecisions.set('p1', { allowed: true, redactedFields: [] });
    state.getByIds.mockImplementation(async (_trx, _tenant, ids: string[]) => ids.map((project_id) => ({
      project_id, client_id: 'c1', client_name: 'Acme',
    })));
    state.clientDecisions.set('c1', { allowed: true, redactedFields: ['fields.email', 'fields.phone_no', 'fields.address'] });
    state.getMaskedByIds.mockImplementation(async (_trx, _tenant, ids: string[]) => ids.map((project_id) => ({
      project_id, client_id: 'c1', client_name: 'Acme',
    })));
    state.locationRows = [{
      location_id: 'l1', client_id: 'c1', location_name: 'HQ', email: 'SECRET-EMAIL', phone: 'SECRET-PHONE',
      phone_extension: '88', fax: 'SECRET-FAX', address_line1: 'SECRET-STREET', city: 'SECRET-CITY',
      state_province: 'SECRET-STATE', postal_code: 'SECRET-ZIP', country_code: 'US', country_name: 'USA',
      region_code: 'SECRET-REGION', is_default: true,
    }];

    const result = await getProjectClientLocationsQuickView('c1', 'p1');

    expect(result).toEqual([expect.objectContaining({
      location_name: 'HQ', email: null, phone: null, phone_extension: null, fax: null,
      address_line1: null, city: null, state_province: null, postal_code: null,
      country_code: null, country_name: null, region_code: null,
    })]);
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(state.queryTable).toHaveBeenCalledWith('client_locations');
  });

  it('does not return locations after coarse client-read denial', async () => {
    state.permission.mockImplementation(async (_user: unknown, resource: string, action: string) =>
      !(resource === 'client' && action === 'read'));

    await expect(getProjectClientLocationsQuickView('c1', 'p1')).rejects.toThrow('Permission denied: Cannot read clients');
    expect(state.queryTable).not.toHaveBeenCalledWith('client_locations');
  });

  it('does not return locations after client-record or source-project denial', async () => {
    state.clientRows = [{ client_id: 'c1' }];
    state.clientDecisions.set('c1', { allowed: false, redactedFields: [] });
    await expect(getProjectClientLocationsQuickView('c1')).rejects.toThrow('Permission denied: Cannot read clients');
    expect(state.queryTable).not.toHaveBeenCalledWith('client_locations');

    state.clientDecisions.set('c1', { allowed: true, redactedFields: [] });
    state.projectRows = [{ project_id: 'p1', assigned_to: null, client_id: 'c1' }];
    state.projectDecisions.set('p1', { allowed: true, redactedFields: ['fields.client_name'] });
    state.getMaskedByIds.mockImplementation(async (_trx, _tenant, ids: string[]) => ids.map((project_id) => ({
      project_id, client_id: 'c1', client_name: null,
    })));
    await expect(getProjectClientLocationsQuickView('c1', 'p1')).rejects.toThrow('Permission denied: Cannot read project client');
    expect(state.queryTable).not.toHaveBeenCalledWith('client_locations');
  });

  it('preserves redacted location fields when a permitted location edit saves visible changes', async () => {
    state.projectRows = [{ project_id: 'p1', assigned_to: null, client_id: 'c1' }];
    state.clientRows = [{ client_id: 'c1' }];
    state.projectDecisions.set('p1', { allowed: true, redactedFields: [] });
    state.getByIds.mockImplementation(async (_trx, _tenant, ids: string[]) => ids.map((project_id) => ({
      project_id, client_id: 'c1', client_name: 'Acme',
    })));
    state.locationRows = [{ location_id: 'l1', client_id: 'c1' }];
    state.clientDecisions.set('c1', { allowed: true, redactedFields: ['fields.email', 'fields.phone_no', 'fields.address'] });
    state.updateQuickViewLocation.mockResolvedValue({ location_id: 'l1', email: 'SECRET-EMAIL' });

    await expect(updateProjectClientLocationQuickView('c1', 'l1', {
      location_name: 'HQ Updated', email: '', phone: '', address_line1: '', city: '',
    }, 'p1')).resolves.toBeUndefined();
    expect(state.updateQuickViewLocation).toHaveBeenCalledWith('l1', { location_name: 'HQ Updated' });
  });

  it('requires client:update before a quick-view location edit reaches the existing writer', async () => {
    state.permission.mockImplementation(async (_user: unknown, resource: string, action: string) =>
      !(resource === 'client' && action === 'update'));

    await expect(updateProjectClientLocationQuickView('c1', 'l1', { location_name: 'HQ' }))
      .rejects.toThrow('Permission denied: Cannot update client locations');
    expect(state.updateQuickViewLocation).not.toHaveBeenCalled();
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
