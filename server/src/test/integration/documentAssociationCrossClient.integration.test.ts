import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createClient, createUser } from '../../../test-utils/testDataFactory';
import { createMockUser, setMockUser, setupCommonMocks } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let mspUserId: string;
let mspTechnicianUserId: string;
let mspTechnicianRoleId: string;
let mspTechnicianPermissions = new Set<string>();
let clientAId: string;
let clientBId: string;
let clientAUserId: string;
let clientBUserId: string;
let taskAId: string;
let taskASecondId: string;
let taskAUnownedId: string;
let taskBId: string;
let searchAssetIds: string[] = [];
let ticketBId: string;
let ticketAVisibleId: string;
let ticketAVisibleSecondId: string;
let ticketAHiddenBoardId: string;
let clientAContactId: string;
let visibleBoardId: string;
let hiddenBoardId: string;
let visibilityGroupId: string;
let contractBId: string;
let contractUnassignedId: string;
let quoteBId: string;
let opportunityBId: string;
let assetDeniedByPolicyId: string | undefined;
let documentAId: string;
let documentBId: string;
let statusOrder = 0;
let mspStorageProviderId: string;
let mspStorageConfigurationId: string;
let mspUploadedFileId: string;
let trackedStorageFileIds: string[] = [];

const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' as string }));
const storageMocks = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  validateFileUpload: vi.fn(async () => undefined),
  deleteFile: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/storage/StorageService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/storage/StorageService')>();
  return {
    ...actual,
    StorageService: {
      ...actual.StorageService,
      uploadFile: storageMocks.uploadFile,
      validateFileUpload: storageMocks.validateFileUpload,
      deleteFile: storageMocks.deleteFile,
    },
  };
});
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  requireTenantId: vi.fn(async () => dbRef.tenant),
  resolveTenantId: vi.fn(async () => dbRef.tenant || null),
}));
vi.mock('server/src/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('server/src/lib/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  getCurrentTenantId: vi.fn(async () => dbRef.tenant || null),
  runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<unknown>) => fn()),
  getConnection: vi.fn(async () => dbRef.knex),
  withTransaction: vi.fn(async <T>(connection: Knex, fn: (trx: Knex.Transaction) => Promise<T>) => connection.transaction(fn)),
}));
vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => dbRef.tenant || null),
  getTenantFromHeaders: vi.fn(() => dbRef.tenant || null),
}));

let searchDocumentAssociationEntities: typeof import('@alga-psa/documents/actions').searchDocumentAssociationEntities;
let createDocumentAssociations: typeof import('@alga-psa/documents/actions').createDocumentAssociations;
let removeDocumentAssociations: typeof import('@alga-psa/documents/actions').removeDocumentAssociations;
let uploadDocument: typeof import('@alga-psa/documents/actions').uploadDocument;
let getClientDocuments: typeof import('@alga-psa/client-portal/actions').getClientDocuments;

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

async function seedProjectTask(clientId: string, taskName: string): Promise<string> {
  const statusId = uuidv4();
  await table('statuses').insert({
    tenant: tenantId, status_id: statusId, name: `Status ${statusId.slice(0, 6)}`,
    status_type: 'project', item_type: 'project', is_closed: false, order_number: 10_000 + statusOrder++, created_by: mspUserId,
  });
  const projectId = uuidv4();
  await table('projects').insert({
    tenant: tenantId, project_id: projectId, client_id: clientId, project_name: `Project ${taskName}`,
    wbs_code: `wbs-${projectId}`, project_number: `P-${projectId.slice(0, 8)}`, status: statusId, is_inactive: false,
  });
  const mappingId = uuidv4();
  await table('project_status_mappings').insert({
    tenant: tenantId, project_status_mapping_id: mappingId, project_id: projectId, status_id: statusId,
    is_standard: false, display_order: 1, is_visible: true,
  });
  const phaseId = uuidv4();
  await table('project_phases').insert({
    tenant: tenantId, phase_id: phaseId, project_id: projectId, phase_name: `Phase ${taskName}`,
    wbs_code: `phase-${phaseId}`, status: 'active', order_number: 1,
  });
  const taskId = uuidv4();
  await table('project_tasks').insert({
    tenant: tenantId, task_id: taskId, phase_id: phaseId, project_status_mapping_id: mappingId,
    task_name: taskName, wbs_code: `task-${taskId}`,
  });
  return taskId;
}

async function seedDocument(clientId = clientAId, createdBy = clientAUserId, name = 'Client A document'): Promise<string> {
  const id = uuidv4();
  await table('documents').insert({
    tenant: tenantId, document_id: id, document_name: name, created_by: createdBy,
    user_id: createdBy, entered_at: new Date(), updated_at: new Date(), is_client_visible: true,
  });
  await table('document_associations').insert({
    tenant: tenantId, association_id: uuidv4(), document_id: id, entity_type: 'client', entity_id: clientId,
    created_at: new Date(),
  });
  return id;
}

describe('document association cross-client authorization', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';
    db = await createTestDbConnection();
    tenantId = await createTenant(db, 'Document Association Security Test Tenant');
    dbRef.knex = db;
    dbRef.tenant = tenantId;
    mspUserId = await createUser(db, tenantId, { username: `msp-${uuidv4().slice(0, 8)}` });
    // Provision this tenant with the canonical default role catalog, then use
    // the persisted MSP Technician role/grants for the upload regression.
    const { getDefaultRoles } = require('../../../migrations/utils/permissions/roleGrants.cjs');
    const defaultRoles = getDefaultRoles('psa') as Array<{ roleName: string; msp: boolean; client: boolean }>;
    await table('roles').insert(defaultRoles.map((role) => ({
      tenant: tenantId, role_id: uuidv4(), role_name: role.roleName, msp: role.msp, client: role.client,
    })));
    const { reconcileAllTenants } = require('../../../migrations/utils/permissions/reconcileTenants.cjs');
    await reconcileAllTenants(db, {
      label: 'document association Technician regression', tenantId, product: 'psa', apply: 'catalog', onDrift: 'throw',
      logger: { log() {}, warn() {}, error() {} },
    });
    const technicianRole = await table('roles').where({ role_name: 'Technician', msp: true, client: false }).first();
    if (!technicianRole) throw new Error('Expected the default MSP Technician role');
    mspTechnicianRoleId = technicianRole.role_id;
    mspTechnicianUserId = await createUser(db, tenantId, { username: `technician-${uuidv4().slice(0, 8)}` });
    await table('user_roles').insert({ tenant: tenantId, user_id: mspTechnicianUserId, role_id: mspTechnicianRoleId });
    const technicianGrants = await table('role_permissions as rp')
      .join('permissions as p', function joinPermission() {
        this.on('rp.permission_id', '=', 'p.permission_id').andOn('rp.tenant', '=', 'p.tenant');
      })
      .where({ 'rp.role_id': mspTechnicianRoleId })
      .select('p.resource', 'p.action');
    mspTechnicianPermissions = new Set(technicianGrants.map((grant: { resource: string; action: string }) => `${grant.resource}:${grant.action}`));
    expect(mspTechnicianPermissions).toContain('document:create');
    expect(mspTechnicianPermissions).toContain('project_task:update');
    expect(mspTechnicianPermissions).not.toContain('project:update');
    clientAId = await createClient(db, tenantId, 'Association Client A');
    clientBId = await createClient(db, tenantId, 'Association Client B');
    clientAContactId = uuidv4();
    await table('contacts').insert({ tenant: tenantId, contact_name_id: clientAContactId, client_id: clientAId, full_name: 'Client A User' });
    clientAUserId = uuidv4();
    await table('users').insert({
      tenant: tenantId, user_id: clientAUserId, username: `client-${clientAUserId.slice(0, 8)}`,
      email: `${clientAUserId}@test.com`, hashed_password: 'test', user_type: 'client', contact_id: clientAContactId,
      first_name: 'Client', last_name: 'A', is_inactive: false,
    });
    const contactBId = uuidv4();
    await table('contacts').insert({ tenant: tenantId, contact_name_id: contactBId, client_id: clientBId, full_name: 'Client B User' });
    clientBUserId = uuidv4();
    await table('users').insert({
      tenant: tenantId, user_id: clientBUserId, username: `client-${clientBUserId.slice(0, 8)}`,
      email: `${clientBUserId}@test.com`, hashed_password: 'test', user_type: 'client', contact_id: contactBId,
      first_name: 'Client', last_name: 'B', is_inactive: false,
    });
    taskAId = await seedProjectTask(clientAId, 'Client A task');
    taskASecondId = await seedProjectTask(clientAId, 'Client A task page two');
    taskAUnownedId = await seedProjectTask(clientAId, 'Client A task not assigned');
    taskBId = await seedProjectTask(clientBId, 'Client B secret task');
    searchAssetIds = [uuidv4(), uuidv4(), uuidv4(), clientAUserId];
    await table('assets').insert(searchAssetIds.map((assetId, index) => ({
      tenant: tenantId, asset_id: assetId, asset_type: 'workstation',
      client_id: index === 2 ? clientBId : clientAId,
      asset_tag: `SEARCH-${assetId.slice(0, 8)}`,
      name: index === 3 ? 'Association search asset ID collision' : 'Association search asset',
      serial_number: 'ASSOCIATION-SEARCH', status: 'active',
    })));
    visibleBoardId = uuidv4();
    hiddenBoardId = uuidv4();
    visibilityGroupId = uuidv4();
    await table('boards').insert([
      { tenant: tenantId, board_id: visibleBoardId, board_name: 'Client A Visible Board', is_default: false, is_inactive: false },
      { tenant: tenantId, board_id: hiddenBoardId, board_name: 'Client A Hidden Board', is_default: false, is_inactive: false },
    ]);
    await table('client_portal_visibility_groups').insert({ tenant: tenantId, group_id: visibilityGroupId, client_id: clientAId, name: 'Association ticket board scope' });
    await table('client_portal_visibility_group_boards').insert({ tenant: tenantId, group_id: visibilityGroupId, board_id: visibleBoardId });
    await table('contacts').where({ contact_name_id: clientAContactId }).update({ portal_visibility_group_id: visibilityGroupId });
    const makeTicket = async (title: string, boardId: string) => {
      const ticketId = uuidv4();
      await table('tickets').insert({
        tenant: tenantId, ticket_id: ticketId, ticket_number: `A-${ticketId.slice(0, 6)}`,
        title, client_id: clientAId, board_id: boardId, contact_name_id: clientAContactId,
        entered_by: mspUserId, entered_at: new Date(), updated_at: new Date(), attributes: {},
      });
      return ticketId;
    };
    ticketAVisibleId = await makeTicket('Client A board ticket visible one', visibleBoardId);
    ticketAVisibleSecondId = await makeTicket('Client A board ticket visible two', visibleBoardId);
    ticketAHiddenBoardId = await makeTicket('Client A hidden board secret', hiddenBoardId);
    ticketBId = uuidv4();
    await table('tickets').insert({
      tenant: tenantId, ticket_id: ticketBId, ticket_number: `B-${ticketBId.slice(0, 6)}`,
      title: 'Client B secret ticket', client_id: clientBId, entered_by: mspUserId, entered_at: new Date(),
      updated_at: new Date(), attributes: {},
    });
    contractBId = uuidv4();
    await table('contracts').insert({
      tenant: tenantId, contract_id: contractBId, contract_name: 'Client B secret contract',
      owner_client_id: clientBId, billing_frequency: 'monthly', currency_code: 'USD', status: 'active',
      is_active: true, is_template: false,
    });
    await table('client_contracts').insert({
      tenant: tenantId, client_contract_id: uuidv4(), client_id: clientBId, contract_id: contractBId,
      start_date: new Date('2026-01-01'), is_active: true,
    });
    contractUnassignedId = uuidv4();
    await table('contracts').insert({
      tenant: tenantId, contract_id: contractUnassignedId, contract_name: 'Unassigned existing contract',
      billing_frequency: 'monthly', currency_code: 'USD', status: 'active', is_active: true, is_template: false,
    });
    quoteBId = uuidv4();
    await table('quotes').insert({
      tenant: tenantId, quote_id: quoteBId, client_id: clientBId, quote_number: `QB-${quoteBId.slice(0, 6)}`,
      title: 'Client B secret quote', status: 'draft', version: 1, is_template: false, currency_code: 'USD',
      subtotal: 0, tax: 0, total_amount: 0, discount_total: 0,
    });
    opportunityBId = uuidv4();
    await table('opportunities').insert({
      tenant: tenantId, opportunity_id: opportunityBId, opportunity_number: `OB-${opportunityBId.slice(0, 6)}`,
      client_id: clientBId, title: 'Client B secret opportunity', opportunity_type: 'new_logo', owner_id: mspUserId,
      currency_code: 'USD', last_activity_at: new Date(), created_by: mspUserId,
    });
    documentAId = await seedDocument();
    documentBId = await seedDocument(clientBId, mspUserId, 'Client B document');
    await table('document_associations').insert({
      tenant: tenantId, association_id: uuidv4(), document_id: documentBId, entity_type: 'project_task', entity_id: taskBId,
      created_at: new Date(),
    });
    ({ searchDocumentAssociationEntities, createDocumentAssociations, removeDocumentAssociations, uploadDocument } =
      await import('@alga-psa/documents/actions'));
    ({ getClientDocuments } = await import('@alga-psa/client-portal/actions'));
  }, 120_000);

  afterAll(async () => {
    if (db && tenantId) {
      await table('document_associations').whereIn('document_id', [documentAId, documentBId]).del();
      await table('documents').whereIn('document_id', [documentAId, documentBId]).del();
      const uploadedDocuments = await table('documents').whereIn('created_by', [mspUserId, mspTechnicianUserId])
        .whereIn('document_name', ['msp-cross-client.txt', 'technician-task-upload.txt']).select('document_id');
      const uploadedIds = uploadedDocuments.map((document: { document_id: string }) => document.document_id);
      if (uploadedIds.length) {
        await table('document_associations').whereIn('document_id', uploadedIds).del();
        await table('documents').whereIn('document_id', uploadedIds).del();
      }
      if (mspUploadedFileId) await table('external_files').where({ file_id: mspUploadedFileId }).del();
      await table('document_folders').whereIn('entity_id', [taskAId, taskBId]).del();
      await table('document_default_folders').whereIn('folder_path', [
        '/Concurrent Tasks', '/Concurrent Tasks/Deliverables', '/Concurrent Tasks/Specifications', '/Concurrent Tasks/Reference',
      ]).del();
      if (mspStorageConfigurationId) await table('storage_configurations').where({ configuration_id: mspStorageConfigurationId }).del();
      if (mspStorageProviderId) await table('storage_providers').where({ provider_id: mspStorageProviderId }).del();
      await table('tickets').whereIn('ticket_id', [ticketBId, ticketAVisibleId, ticketAVisibleSecondId, ticketAHiddenBoardId]).del();
      await table('client_portal_visibility_group_boards').where({ group_id: visibilityGroupId }).del();
      await table('client_portal_visibility_groups').where({ group_id: visibilityGroupId }).del();
      await table('quotes').where({ quote_id: quoteBId }).del();
      await table('opportunities').where({ opportunity_id: opportunityBId }).del();
      await table('client_contracts').where({ contract_id: contractBId }).del();
      await table('contracts').whereIn('contract_id', [contractBId, contractUnassignedId]).del();
      if (assetDeniedByPolicyId) {
        await table('asset_associations').where({ asset_id: assetDeniedByPolicyId }).del();
        await table('assets').where({ asset_id: assetDeniedByPolicyId }).del();
      }
      await table('asset_associations').whereIn('asset_id', searchAssetIds).del();
      await table('assets').whereIn('asset_id', searchAssetIds).del();
      await table('boards').whereIn('board_id', [visibleBoardId, hiddenBoardId]).del();
      const projects = await table('projects').whereIn('client_id', [clientAId, clientBId]).pluck('project_id');
      const phases = projects.length ? await table('project_phases').whereIn('project_id', projects).select('phase_id') : [];
      const phaseIds = phases.map((phase: { phase_id: string }) => phase.phase_id);
      if (phaseIds.length) await table('project_tasks').whereIn('phase_id', phaseIds).del();
      if (phaseIds.length) await table('project_phases').whereIn('phase_id', phaseIds).del();
      if (projects.length) await table('project_status_mappings').whereIn('project_id', projects).del();
      if (projects.length) await table('projects').whereIn('project_id', projects).del();
      await table('statuses').where('created_by', mspUserId).andWhere('status_type', 'project').del();
      await table('user_roles').where({ user_id: mspTechnicianUserId }).del();
      await table('users').whereIn('user_id', [clientAUserId, clientBUserId, mspTechnicianUserId]).del();
      await table('contacts').whereIn('client_id', [clientAId, clientBId]).del();
      await table('clients').whereIn('client_id', [clientAId, clientBId]).del();
      await table('role_permissions').where({ tenant: tenantId }).del();
      await table('roles').where({ tenant: tenantId }).del();
      await table('permissions').where({ tenant: tenantId }).del();
    }
    await db?.destroy();
  });

  afterEach(async () => {
    if (!db || !tenantId) return;
    await table('assets').where('asset_tag', 'like', 'SCALE-%').del();
    await table('project_tasks').where('task_name', 'like', 'scale-%').del();
    await table('document_associations').where({ document_id: documentAId }).del();
    await table('document_associations').insert({
      tenant: tenantId, association_id: uuidv4(), document_id: documentAId,
      entity_type: 'client', entity_id: clientAId, created_at: new Date(),
    });
    const uploadedDocuments = await table('documents').whereIn('created_by', [mspUserId, mspTechnicianUserId])
      .whereIn('document_name', ['msp-cross-client.txt', 'technician-task-upload.txt', 'folder-concurrent-a.txt', 'folder-concurrent-b.txt'])
      .select('document_id', 'file_id');
    const uploadedIds = uploadedDocuments.map((document: { document_id: string }) => document.document_id);
    const uploadedFileIds = [...new Set([
      ...uploadedDocuments.map((document: { file_id?: string }) => document.file_id).filter(Boolean),
      ...trackedStorageFileIds,
    ])];
    if (uploadedIds.length) {
      await table('document_associations').whereIn('document_id', uploadedIds).del();
      await table('documents').whereIn('document_id', uploadedIds).del();
    }
    if (uploadedFileIds.length) await table('external_files').whereIn('file_id', uploadedFileIds).del();
    trackedStorageFileIds = [];
    if (assetDeniedByPolicyId) {
      await table('asset_associations').where({ asset_id: assetDeniedByPolicyId }).del();
      await table('assets').where({ asset_id: assetDeniedByPolicyId }).del();
      assetDeniedByPolicyId = undefined;
    }
    await table('document_folders').whereIn('entity_id', [taskAId, taskBId]).del();
    await table('document_default_folders').whereIn('folder_path', [
      '/Concurrent Tasks', '/Concurrent Tasks/Deliverables', '/Concurrent Tasks/Specifications', '/Concurrent Tasks/Reference',
    ]).del();
    if (mspStorageConfigurationId) await table('storage_configurations').where({ configuration_id: mspStorageConfigurationId }).del();
    if (mspStorageProviderId) await table('storage_providers').where({ provider_id: mspStorageProviderId }).del();
  });

  it('scopes search counts and rejects cross-client attach, upload, and removal without persisted changes', async () => {
    const clientUser = createMockUser('client', {
      user_id: clientAUserId, tenant: tenantId, clientId: clientAId,
      contact_id: clientAContactId,
    });
    const clientPermissions = new Set([
      'document:read', 'document:create', 'document:update', 'client:read', 'contact:read', 'ticket:read',
      'asset:read', 'project:read', 'project:update', 'project_task:update', 'billing:read', 'billing:update', 'opportunities:read', 'opportunities:update',
    ]);
    setMockUser(clientUser, [...clientPermissions]);
    setupCommonMocks({ tenantId, userId: clientAUserId, user: clientUser, permissionCheck: (_user, resource, action) => clientPermissions.has(`${resource}:${action}`) });


    const ownTaskRows = await table('project_tasks').whereIn('task_id', [taskAId, taskASecondId]).select('phase_id');
    const ownProjectIds = await table('project_phases').whereIn('phase_id', ownTaskRows.map((row: { phase_id: string }) => row.phase_id)).pluck('project_id');
    await table('projects').whereIn('project_id', ownProjectIds).update({ assigned_to: clientAUserId });
    const bundleService = await import('@alga-psa/authorization/bundles/service');
    const projectReadRule = vi.spyOn(bundleService, 'resolveBundleNarrowingRulesForEvaluation').mockImplementation(async (_trx, input) =>
      input.resource.type === 'project' && input.resource.action === 'read'
        ? [{ id: 'own-projects', resource: 'project', action: 'read', templateKey: 'own', constraintKey: 'hide_sensitive_fields' }]
        : []
    );
    try {
      const hiddenTask = await searchDocumentAssociationEntities('project_task', 'Client B secret task', 1, 50);
      expect(hiddenTask).toEqual({ options: [], total: 0 });
      const ownTask = await searchDocumentAssociationEntities('project_task', 'Client A task', 1, 50);
      expect(ownTask.options.map((item: { value: string }) => item.value)).toContain(taskAId);
      const taskPage1 = await searchDocumentAssociationEntities('project_task', 'Client A task', 1, 1);
      const taskPage2 = await searchDocumentAssociationEntities('project_task', 'Client A task', 2, 1);
      expect(taskPage1.total).toBe(2);
      expect(taskPage2.total).toBe(2);
      expect([taskPage1.options[0].value, taskPage2.options[0].value].sort()).toEqual([taskAId, taskASecondId].sort());
      expect([taskPage1.options[0].value, taskPage2.options[0].value]).not.toContain(taskAUnownedId);
    } finally {
      projectReadRule.mockRestore();
      await table('projects').whereIn('project_id', ownProjectIds).update({ assigned_to: null });
    }
    const assetMatches = await searchDocumentAssociationEntities('asset', 'Association search asset', 1, 50);
    const clientAAssetIds = [searchAssetIds[0], searchAssetIds[1], searchAssetIds[3]];
    expect(assetMatches.total).toBe(3);
    expect(assetMatches.options.map((item: { value: string }) => item.value).sort()).toEqual(clientAAssetIds.sort());
    expect(await searchDocumentAssociationEntities('asset', 'Association search asset', 1, 1)).toMatchObject({ total: 3 });
    expect(await searchDocumentAssociationEntities('asset', 'Association search asset', 2, 1)).toMatchObject({ total: 3 });
    expect(await searchDocumentAssociationEntities('asset', 'Association search asset', 1, 10)).toMatchObject({ total: 3 });
    await table('asset_associations').insert([
      { tenant: tenantId, asset_id: searchAssetIds[0], entity_type: 'user', entity_id: '00000000-0000-4000-8000-000000000001', created_by: mspUserId },
      { tenant: tenantId, asset_id: searchAssetIds[0], entity_type: 'user', entity_id: clientAUserId, created_by: mspUserId },
      { tenant: tenantId, asset_id: searchAssetIds[1], entity_type: 'user', entity_id: clientAUserId, created_by: mspUserId },
      { tenant: tenantId, asset_id: searchAssetIds[2], entity_type: 'user', entity_id: clientBUserId, created_by: mspUserId },
    ]);
    const { createAssetReadContext, isAssetReadAllowed } = await import('@alga-psa/authorization/assetReadAuthorization');
    const candidateAssets = [
      { asset_id: searchAssetIds[0], client_id: clientAId },
      { asset_id: searchAssetIds[1], client_id: clientAId },
      { asset_id: searchAssetIds[2], client_id: clientBId },
      { asset_id: searchAssetIds[3], client_id: clientAId },
    ];
    const expectedKernelIds: Record<'own' | 'own_or_assigned' | 'own_or_managed', string[]> = {
      own: [], own_or_assigned: [], own_or_managed: [],
    };
    for (const templateKey of ['own', 'own_or_assigned', 'own_or_managed'] as const) {
      const ownerRule = vi.spyOn(bundleService, 'resolveBundleNarrowingRulesForEvaluation').mockImplementation(async (_trx, input) =>
        input.resource.type === 'asset' && input.resource.action === 'read'
          ? [{
            id: `asset-${templateKey}`, resource: 'asset', action: 'read', templateKey,
            constraintKey: 'hide_sensitive_fields',
          }]
          : []
      );
      try {
        const context = await createAssetReadContext(db, tenantId, clientUser);
        const kernelAllowedIds: string[] = [];
        for (const asset of candidateAssets) {
          if (await isAssetReadAllowed(db, tenantId, context, asset)) kernelAllowedIds.push(asset.asset_id);
        }
        expectedKernelIds[templateKey] = [...kernelAllowedIds].sort();
        const expectedIdsByRule = {
          own: [searchAssetIds[1]],
          own_or_assigned: [searchAssetIds[0], searchAssetIds[1]],
          own_or_managed: [searchAssetIds[1]],
        }[templateKey].sort();
        expect(expectedKernelIds[templateKey]).toEqual(expectedIdsByRule);
        const page1 = await searchDocumentAssociationEntities('asset', 'Association search asset', 1, 1);
        const page2 = await searchDocumentAssociationEntities('asset', 'Association search asset', 2, 1);
        expect(page1.total).toBe(kernelAllowedIds.length);
        expect(page2.total).toBe(kernelAllowedIds.length);
        expect([...page1.options, ...page2.options].map((item: { value: string }) => item.value).sort())
          .toEqual(expectedKernelIds[templateKey]);
      } finally {
        ownerRule.mockRestore();
      }
    }
    await table('asset_associations').whereIn('asset_id', searchAssetIds).del();
    const hiddenClient = await searchDocumentAssociationEntities('client', 'Association Client B', 1, 50);
    expect(hiddenClient).toEqual({ options: [], total: 0 });
    const hiddenTicket = await searchDocumentAssociationEntities('ticket', 'Client B secret ticket', 1, 50);
    expect(hiddenTicket).toEqual({ options: [], total: 0 });
    const hiddenContract = await searchDocumentAssociationEntities('contract', 'Client B secret contract', 1, 50);
    expect(hiddenContract).toEqual({ options: [], total: 0 });
    const hiddenQuote = await searchDocumentAssociationEntities('quote', 'Client B secret quote', 1, 50);
    expect(hiddenQuote).toEqual({ options: [], total: 0 });
    const hiddenOpportunity = await searchDocumentAssociationEntities('opportunity', 'Client B secret opportunity', 1, 50);
    expect(hiddenOpportunity).toEqual({ options: [], total: 0 });
    const visibleTicketPage1 = await searchDocumentAssociationEntities('ticket', 'Client A board ticket visible', 1, 1);
    expect(visibleTicketPage1.total).toBe(2);
    expect(visibleTicketPage1.options).toHaveLength(1);
    const visibleTicketPage2 = await searchDocumentAssociationEntities('ticket', 'Client A board ticket visible', 2, 1);
    expect(visibleTicketPage2.total).toBe(2);
    expect(visibleTicketPage2.options).toHaveLength(1);
    expect([
      ...visibleTicketPage1.options.map((item: { value: string }) => item.value),
      ...visibleTicketPage2.options.map((item: { value: string }) => item.value),
    ].sort()).toEqual([ticketAVisibleId, ticketAVisibleSecondId].sort());
    expect(await searchDocumentAssociationEntities('ticket', 'Client A hidden board secret', 1, 50)).toEqual({ options: [], total: 0 });

    expect(await createDocumentAssociations(taskAId, 'project_task', [documentAId])).toEqual({ success: true });
    expect(await table('document_associations').where({ document_id: documentAId, entity_id: taskAId })).toHaveLength(1);
    expect(await removeDocumentAssociations(taskAId, 'project_task', [documentAId])).toEqual({ success: true });

    const deniedDocumentAssociation = await createDocumentAssociations(taskAId, 'project_task', [documentBId]);
    expect(deniedDocumentAssociation).toHaveProperty('permissionError');
    const bDocumentAssociationsBeforeRemove = await table('document_associations')
      .where({ document_id: documentBId, entity_type: 'project_task', entity_id: taskBId }).select('association_id');
    const deniedDocumentRemoval = await removeDocumentAssociations(taskBId, 'project_task', [documentBId]);
    expect(deniedDocumentRemoval).toHaveProperty('permissionError');
    expect(await table('document_associations')
      .where({ document_id: documentBId, entity_type: 'project_task', entity_id: taskBId }).select('association_id'))
      .toEqual(bDocumentAssociationsBeforeRemove);

    const beforeAssociations = await table('document_associations').select('association_id', 'entity_id', 'entity_type').where({ document_id: documentAId });
    const createResult = await createDocumentAssociations(taskBId, 'project_task', [documentAId]);
    expect(createResult).toHaveProperty('permissionError');
    const removeResult = await removeDocumentAssociations(taskBId, 'project_task', [documentAId]);
    expect(removeResult).toHaveProperty('permissionError');

    const form = new FormData();
    form.set('file', new File(['cross-client upload'], 'cross-client.txt', { type: 'text/plain' }));
    const uploadResult = await uploadDocument(form, { userId: clientAUserId, projectTaskId: taskBId });
    expect(uploadResult).toHaveProperty('permissionError');
    expect(await table('documents').where({ created_by: clientAUserId, document_name: 'cross-client.txt' })).toHaveLength(0);
    expect(await table('document_folders').where({ entity_id: taskBId })).toHaveLength(0);
    expect(await table('document_associations').select('association_id', 'entity_id', 'entity_type').where({ document_id: documentAId })).toEqual(beforeAssociations);

    const clientBUser = createMockUser('client', { user_id: clientBUserId, tenant: tenantId, clientId: clientBId, contact_id: undefined });
    setMockUser(clientBUser, ['document:read']);
    setupCommonMocks({ tenantId, userId: clientBUser.user_id, user: clientBUser, permissionCheck: (_user, resource, action) => resource === 'document' && action === 'read' });
    const clientDocuments = await getClientDocuments(1, 20, {});
    expect(clientDocuments.documents.map((document: { document_id: string }) => document.document_id)).not.toContain(documentAId);

    const mspUser = createMockUser('internal', { user_id: mspUserId, tenant: tenantId });
    const mspPermissions = new Set([
      'document:read', 'document:create', 'document:update', 'project:read', 'project:update', 'project_task:update', 'billing:read',
      'billing:update', 'opportunities:read', 'opportunities:update',
    ]);
    setMockUser(mspUser, [...mspPermissions]);
    setupCommonMocks({ tenantId, userId: mspUserId, user: mspUser, permissionCheck: (_user, resource, action) => mspPermissions.has(`${resource}:${action}`) });
    const mspTasks = await searchDocumentAssociationEntities('project_task', '', 1, 50);
    expect(mspTasks.total).toBeGreaterThanOrEqual(2);
    expect(mspTasks.options.map((item: { value: string }) => item.value)).toEqual(expect.arrayContaining([taskAId, taskBId]));
    for (const [type, search, expectedId] of [
      ['contract', 'Client B secret contract', contractBId],
      ['quote', 'Client B secret quote', quoteBId],
      ['opportunity', 'Client B secret opportunity', opportunityBId],
    ] as const) {
      const result = await searchDocumentAssociationEntities(type, search, 1, 10);
      expect(result.options.map((item: { value: string }) => item.value)).toContain(expectedId);
    }
    const unassignedContractSearch = await searchDocumentAssociationEntities('contract', 'Unassigned existing contract', 1, 10);
    expect(unassignedContractSearch.options.map((item: { value: string }) => item.value)).toContain(contractUnassignedId);
    expect(await createDocumentAssociations(contractUnassignedId, 'contract', [documentAId])).toEqual({ success: true });
    expect(await removeDocumentAssociations(contractUnassignedId, 'contract', [documentAId])).toEqual({ success: true });
    expect(await createDocumentAssociations(uuidv4(), 'contract', [documentAId])).toHaveProperty('permissionError');
    expect(await createDocumentAssociations(taskBId, 'project_task', [documentAId])).toEqual({ success: true });
    expect(await table('document_associations').where({ document_id: documentAId, entity_id: taskBId })).toHaveLength(1);
    for (const [type, id] of [['contract', contractBId], ['quote', quoteBId], ['opportunity', opportunityBId]] as const) {
      expect(await createDocumentAssociations(id, type, [documentAId])).toEqual({ success: true });
      expect(await removeDocumentAssociations(id, type, [documentAId])).toEqual({ success: true });
    }

    mspStorageProviderId = uuidv4();
    mspStorageConfigurationId = uuidv4();
    mspUploadedFileId = uuidv4();
    await table('storage_providers').insert({
      tenant: tenantId, provider_id: mspStorageProviderId, provider_type: 'local', provider_name: 'Association test storage', config: {},
    });
    await table('storage_configurations').insert({
      tenant: tenantId, configuration_id: mspStorageConfigurationId, provider_id: mspStorageProviderId,
      name: 'Association test storage', path: '/', is_default: true,
    });
    await table('external_files').insert({
      tenant: tenantId, file_id: mspUploadedFileId,
      file_name: 'msp-cross-client.txt', original_name: 'msp-cross-client.txt', mime_type: 'text/plain',
      file_size: 22, storage_path: `test/${mspUploadedFileId}`, uploaded_by_id: mspUserId,
    });
    storageMocks.uploadFile.mockResolvedValue({ file_id: mspUploadedFileId, storage_path: `test/${mspUploadedFileId}` });
    trackedStorageFileIds.push(mspUploadedFileId);
    const uploadForm = new FormData();
    uploadForm.set('file', new File(['MSP cross-client upload'], 'msp-cross-client.txt', { type: 'text/plain' }));
    const authorizedUpload = await uploadDocument(uploadForm, { userId: mspUserId, projectTaskId: taskBId });
    expect(authorizedUpload).toHaveProperty('success', true);
    const uploaded = await table('documents').where({ created_by: mspUserId, document_name: 'msp-cross-client.txt' }).first();
    expect(uploaded).toBeDefined();
    if (!uploaded) throw new Error('Expected authorized MSP upload to persist its document');
    expect(await table('document_associations').where({ document_id: uploaded.document_id, entity_id: taskBId })).toHaveLength(1);
  });

  it('lets the default MSP Technician upload to an authorized task without project:update', async () => {
    const technician = createMockUser('internal', {
      user_id: mspTechnicianUserId, tenant: tenantId,
      roles: [{ role_id: mspTechnicianRoleId, role_name: 'Technician' }],
    });
    setMockUser(technician, [...mspTechnicianPermissions]);
    setupCommonMocks({
      tenantId, userId: mspTechnicianUserId, user: technician,
      permissionCheck: (_user, resource, action) => mspTechnicianPermissions.has(`${resource}:${action}`),
    });
    const authModule = await import('@alga-psa/auth');
    const { hasPermission: hasPersistedPermission } = await import('@alga-psa/authorization/rbac');
    vi.mocked(authModule.hasPermission).mockImplementation((user, resource, action, connection) =>
      hasPersistedPermission(user, resource, action, connection));

    expect(mspTechnicianPermissions).toContain('document:create');
    expect(mspTechnicianPermissions).toContain('project_task:update');
    expect(mspTechnicianPermissions).not.toContain('project:update');
    expect(await hasPersistedPermission(technician, 'document', 'create', db)).toBe(true);
    expect(await hasPersistedPermission(technician, 'project_task', 'update', db)).toBe(true);
    expect(await hasPersistedPermission(technician, 'project', 'update', db)).toBe(false);

    const storageFileId = uuidv4();
    mspStorageProviderId = uuidv4();
    mspStorageConfigurationId = uuidv4();
    await table('storage_providers').insert({
      tenant: tenantId, provider_id: mspStorageProviderId, provider_type: 'local', provider_name: 'Technician regression storage', config: {},
    });
    await table('storage_configurations').insert({
      tenant: tenantId, configuration_id: mspStorageConfigurationId, provider_id: mspStorageProviderId,
      name: 'Technician regression storage', path: '/', is_default: true,
    });
    await table('external_files').insert({
      tenant: tenantId, file_id: storageFileId, file_name: 'technician-task-upload.txt',
      original_name: 'technician-task-upload.txt', mime_type: 'text/plain', file_size: 29,
      storage_path: `test/${storageFileId}`, uploaded_by_id: mspTechnicianUserId,
    });
    trackedStorageFileIds.push(storageFileId);
    storageMocks.uploadFile.mockResolvedValueOnce({ file_id: storageFileId, storage_path: `test/${storageFileId}` });
    const form = new FormData();
    form.set('file', new File(['Technician task attachment'], 'technician-task-upload.txt', { type: 'text/plain' }));

    const result = await uploadDocument(form, { userId: mspTechnicianUserId, projectTaskId: taskAId });
    expect(result).toHaveProperty('success', true);
    const persisted = await table('documents')
      .where({ created_by: mspTechnicianUserId, document_name: 'technician-task-upload.txt' }).first();
    expect(persisted).toBeDefined();
    if (!persisted) throw new Error('Expected the Technician document to persist');
    expect(await table('document_associations').where({
      document_id: persisted.document_id, entity_type: 'project_task', entity_id: taskAId,
    })).toHaveLength(1);
  });

  it('requires document:update for association mutations and parent-document uploads even when read/create are granted', async () => {
    const clientUser = createMockUser('client', {
      user_id: clientAUserId, tenant: tenantId, clientId: clientAId, contact_id: clientAContactId,
    });
    const grants = new Set(['document:read', 'document:create', 'project:update', 'project_task:update']);
    setMockUser(clientUser, [...grants]);
    setupCommonMocks({
      tenantId, userId: clientAUserId, user: clientUser,
      permissionCheck: (_user, resource, action) => grants.has(`${resource}:${action}`),
    });

    const readable = await getClientDocuments(1, 20, {});
    expect(readable.documents.map((document: { document_id: string }) => document.document_id)).toContain(documentAId);

    await table('document_associations').insert({
      tenant: tenantId, association_id: uuidv4(), document_id: documentAId,
      entity_type: 'project_task', entity_id: taskAId, created_at: new Date(),
    });
    const existingAssociation = await table('document_associations')
      .where({ document_id: documentAId, entity_type: 'project_task', entity_id: taskAId }).select('association_id');
    expect(await createDocumentAssociations(taskAId, 'project_task', [documentAId])).toHaveProperty('permissionError');
    expect(await removeDocumentAssociations(taskAId, 'project_task', [documentAId])).toHaveProperty('permissionError');
    expect(await table('document_associations')
      .where({ document_id: documentAId, entity_type: 'project_task', entity_id: taskAId }).select('association_id'))
      .toEqual(existingAssociation);

    storageMocks.uploadFile.mockClear();
    const parentUpload = new FormData();
    parentUpload.set('file', new File(['parent image'], 'parent-image.txt', { type: 'text/plain' }));
    const parentUploadResult = await uploadDocument(parentUpload, { userId: clientAUserId, parentDocumentId: documentAId });
    expect(parentUploadResult).toHaveProperty('permissionError');
    expect(storageMocks.uploadFile).not.toHaveBeenCalled();
    expect(await table('documents').where({ created_by: clientAUserId, document_name: 'parent-image.txt' })).toHaveLength(0);
  });

  it('rolls back folder and document writes and cleans uploaded storage after a late target denial', async () => {
    const clientUser = createMockUser('client', {
      user_id: clientAUserId, tenant: tenantId, clientId: clientAId, contact_id: clientAContactId,
    });
    const grants = new Set([
      'document:read', 'document:create', 'document:update', 'project:read', 'project:update', 'project_task:update',
    ]);
    setMockUser(clientUser, [...grants]);
    setupCommonMocks({
      tenantId, userId: clientAUserId, user: clientUser,
      permissionCheck: (_user, resource, action) => grants.has(`${resource}:${action}`),
    });

    const project = await table('project_tasks as pt')
      .join('project_phases as pp', 'pt.phase_id', 'pp.phase_id')
      .join('projects as p', 'pp.project_id', 'p.project_id')
      .where('pt.task_id', taskAId).first('p.project_id');
    if (!project?.project_id) throw new Error('Expected Client A task project');
    const projectId = project.project_id as string;
    const foldersBefore = await table('document_folders').where({ entity_id: taskAId }).select('folder_id', 'folder_path');
    const associationsBefore = await table('document_associations').where({ entity_id: taskAId }).select('association_id', 'document_id', 'entity_type');
    const storageFileId = uuidv4();
    storageMocks.uploadFile.mockClear();
    storageMocks.deleteFile.mockClear();
    storageMocks.uploadFile.mockImplementationOnce(async () => {
      // Move the target out of the client's scope after the early check and file upload,
      // so only the transaction's final authorization check catches the change.
      await table('projects').where({ project_id: projectId }).update({ client_id: clientBId });
      return { file_id: storageFileId, storage_path: `test/${storageFileId}` };
    });

    const lateDeniedForm = new FormData();
    lateDeniedForm.set('file', new File(['late denial'], 'late-denial.txt', { type: 'text/plain' }));
    try {
      const result = await uploadDocument(lateDeniedForm, { userId: clientAUserId, projectTaskId: taskAId });
      expect(result).toHaveProperty('permissionError');
      expect(await table('documents').where({ created_by: clientAUserId, document_name: 'late-denial.txt' })).toHaveLength(0);
      expect(await table('document_associations').where({ entity_id: taskAId }).select('association_id', 'document_id', 'entity_type')).toEqual(associationsBefore);
      expect(await table('document_folders').where({ entity_id: taskAId }).select('folder_id', 'folder_path')).toEqual(foldersBefore);
      expect(storageMocks.deleteFile).toHaveBeenCalledWith(storageFileId, clientAUserId);
    } finally {
      await table('projects').where({ project_id: projectId }).update({ client_id: clientAId });
    }
  });

  it('restricts client contract mutations to their exclusive client scope while preserving MSP sharing', async () => {
    const ownAssignmentId = uuidv4();
    const sharedAssignmentId = uuidv4();
    await table('client_contracts').insert([
      { tenant: tenantId, client_contract_id: ownAssignmentId, client_id: clientAId, contract_id: contractUnassignedId, start_date: new Date('2026-01-01'), is_active: true },
      { tenant: tenantId, client_contract_id: sharedAssignmentId, client_id: clientAId, contract_id: contractBId, start_date: new Date('2026-01-01'), is_active: true },
    ]);
    const clientUser = createMockUser('client', {
      user_id: clientAUserId, tenant: tenantId, clientId: clientAId, contact_id: clientAContactId,
    });
    const grants = new Set(['document:read', 'document:create', 'document:update', 'billing:read', 'billing:update']);
    const actAs = (user: ReturnType<typeof createMockUser>) => {
      setMockUser(user, [...grants]);
      setupCommonMocks({
        tenantId, userId: user.user_id, user,
        permissionCheck: (_user, resource, action) => grants.has(`${resource}:${action}`),
      });
    };
    const viewerB = createMockUser('client', { user_id: clientBUserId, tenant: tenantId, clientId: clientBId });
    const { authorizeAndRedactDocuments } = await import('@shared/lib/documentAuthorization');
    const readableByB = async () => {
      const documents = await table('documents').where({ document_id: documentAId });
      return db.transaction((trx) => authorizeAndRedactDocuments(trx, tenantId, viewerB, documents));
    };

    try {
      actAs(clientUser);
      // A client can still manage documents on a contract assigned only to them.
      expect(await createDocumentAssociations(contractUnassignedId, 'contract', [documentAId])).toEqual({ success: true });
      expect(await removeDocumentAssociations(contractUnassignedId, 'contract', [documentAId])).toEqual({ success: true });

      const associationsBefore = await table('document_associations').where({ document_id: documentAId }).orderBy('association_id');
      const foldersBefore = await table('document_folders').where({ entity_type: 'contract', entity_id: contractBId }).orderBy('folder_id');
      expect(await createDocumentAssociations(contractBId, 'contract', [documentAId])).toHaveProperty('permissionError');
      storageMocks.uploadFile.mockClear();
      const form = new FormData();
      form.set('file', new File(['shared contract injection'], 'shared-contract-injection.txt', { type: 'text/plain' }));
      expect(await uploadDocument(form, { userId: clientAUserId, contractId: contractBId })).toHaveProperty('permissionError');
      expect(storageMocks.uploadFile).not.toHaveBeenCalled();
      expect(await table('documents').where({ document_name: 'shared-contract-injection.txt' })).toHaveLength(0);
      expect(await table('document_associations').where({ document_id: documentAId }).orderBy('association_id')).toEqual(associationsBefore);
      expect(await table('document_folders').where({ entity_type: 'contract', entity_id: contractBId }).orderBy('folder_id')).toEqual(foldersBefore);
      expect(await readableByB()).toHaveLength(0);

      // MSPs may intentionally publish a document to every client of a contract.
      const mspUser = createMockUser('internal', { user_id: mspUserId, tenant: tenantId });
      actAs(mspUser);
      expect(await createDocumentAssociations(contractBId, 'contract', [documentAId])).toEqual({ success: true });
      expect((await readableByB()).map((document) => document.document_id)).toContain(documentAId);

      const sharedAssociations = await table('document_associations').where({ document_id: documentAId }).orderBy('association_id');
      actAs(clientUser);
      expect(await removeDocumentAssociations(contractBId, 'contract', [documentAId])).toHaveProperty('permissionError');
      expect(await table('document_associations').where({ document_id: documentAId }).orderBy('association_id')).toEqual(sharedAssociations);

      actAs(mspUser);
      expect(await removeDocumentAssociations(contractBId, 'contract', [documentAId])).toEqual({ success: true });
      expect(await readableByB()).toHaveLength(0);
    } finally {
      await table('client_contracts').whereIn('client_contract_id', [ownAssignmentId, sharedAssignmentId]).del();
    }
  });

  it('denies asset association writes when record policy denies access despite asset:update', async () => {
    assetDeniedByPolicyId = uuidv4();
    await table('assets').insert({
      tenant: tenantId, asset_id: assetDeniedByPolicyId, asset_type: 'workstation', client_id: clientAId,
      asset_tag: `AUTH-${assetDeniedByPolicyId.slice(0, 8)}`, name: 'Policy restricted asset', status: 'active',
    });
    await table('document_associations').insert({
      tenant: tenantId, association_id: uuidv4(), document_id: documentAId,
      entity_type: 'asset', entity_id: assetDeniedByPolicyId, created_at: new Date(),
    });

    const mspUser = createMockUser('internal', { user_id: mspUserId, tenant: tenantId });
    const grants = new Set(['document:read', 'document:update', 'asset:read', 'asset:update']);
    const checkedPermissions: string[] = [];
    setMockUser(mspUser, [...grants]);
    setupCommonMocks({
      tenantId, userId: mspUserId, user: mspUser,
      permissionCheck: (_user, resource, action) => {
        checkedPermissions.push(`${resource}:${action}`);
        return grants.has(`${resource}:${action}`);
      },
    });

    const bundleService = await import('@alga-psa/authorization/bundles/service');
    const ruleSpy = vi.spyOn(bundleService, 'resolveBundleNarrowingRulesForEvaluation').mockImplementation(async (_trx, input) =>
      input.resource.type === 'asset' && input.resource.action === 'read'
        ? [{ id: 'deny-asset-record', resource: 'asset', action: 'read', templateKey: 'same_team' }]
        : []
    );
    try {
      expect(await searchDocumentAssociationEntities('asset', 'Policy restricted asset', 1, 10)).toEqual({ options: [], total: 0 });
      expect(await createDocumentAssociations(assetDeniedByPolicyId, 'asset', [documentAId])).toHaveProperty('permissionError');
      const beforeRemoval = await table('document_associations')
        .where({ document_id: documentAId, entity_type: 'asset', entity_id: assetDeniedByPolicyId }).select('association_id');
      expect(beforeRemoval).toHaveLength(1);
      expect(await removeDocumentAssociations(assetDeniedByPolicyId, 'asset', [documentAId])).toHaveProperty('permissionError');
      expect(await table('document_associations')
        .where({ document_id: documentAId, entity_type: 'asset', entity_id: assetDeniedByPolicyId }).select('association_id'))
        .toEqual(beforeRemoval);
      expect(checkedPermissions).toContain('asset:update');
    } finally {
      ruleSpy.mockRestore();
    }
  });

  it('applies document update bundle policy separately from read to association mutations and parent uploads', async () => {
    const clientUser = createMockUser('client', {
      user_id: clientAUserId, tenant: tenantId, clientId: clientAId, contact_id: clientAContactId,
    });
    const grants = new Set(['document:read', 'document:create', 'document:update', 'project:update', 'project_task:update']);
    setMockUser(clientUser, [...grants]);
    setupCommonMocks({
      tenantId, userId: clientAUserId, user: clientUser,
      permissionCheck: (_user, resource, action) => grants.has(`${resource}:${action}`),
    });
    const beforeDocuments = await table('documents').where({ document_id: documentAId }).select('document_id', 'folder_path');
    const beforeFolders = await table('document_folders').where({ entity_id: taskAId }).select('folder_id', 'folder_path');
    await table('document_associations').insert({
      tenant: tenantId, association_id: uuidv4(), document_id: documentAId,
      entity_type: 'project_task', entity_id: taskAId, created_at: new Date(),
    });
    const existingTaskAssociation = await table('document_associations')
      .where({ document_id: documentAId, entity_type: 'project_task', entity_id: taskAId }).select('association_id');
    const expectedAssociations = await table('document_associations')
      .where({ document_id: documentAId }).select('association_id', 'entity_id', 'entity_type');

    const bundleService = await import('@alga-psa/authorization/bundles/service');
    const ruleSpy = vi.spyOn(bundleService, 'resolveBundleNarrowingRulesForEvaluation').mockImplementation(async (_trx, input) =>
      input.resource.type === 'document' && input.resource.action === 'update'
        ? [{ id: 'deny-document-update', resource: 'document', action: 'update', templateKey: 'same_team' }]
        : []
    );
    try {
      const readable = await getClientDocuments(1, 20, {});
      expect(readable.documents.map((document: { document_id: string }) => document.document_id)).toContain(documentAId);
      expect(await createDocumentAssociations(taskAId, 'project_task', [documentAId])).toHaveProperty('permissionError');
      expect(await removeDocumentAssociations(taskAId, 'project_task', [documentAId])).toHaveProperty('permissionError');
      expect(await table('document_associations')
        .where({ document_id: documentAId, entity_type: 'project_task', entity_id: taskAId }).select('association_id'))
        .toEqual(existingTaskAssociation);

      storageMocks.uploadFile.mockClear();
      const parentUpload = new FormData();
      parentUpload.set('file', new File(['update policy'], 'update-policy-parent.txt', { type: 'text/plain' }));
      expect(await uploadDocument(parentUpload, { userId: clientAUserId, parentDocumentId: documentAId })).toHaveProperty('permissionError');
      expect(storageMocks.uploadFile).not.toHaveBeenCalled();
      expect(await table('documents').where({ document_id: documentAId }).select('document_id', 'folder_path')).toEqual(beforeDocuments);
      expect(await table('document_folders').where({ entity_id: taskAId }).select('folder_id', 'folder_path')).toEqual(beforeFolders);
      expect(await table('document_associations')
        .where({ document_id: documentAId }).select('association_id', 'entity_id', 'entity_type'))
        .toEqual(expectedAssociations);
    } finally {
      ruleSpy.mockRestore();
    }
  });

  it('completes concurrent first uploads through one entity-folder initialization and retains both files', async () => {
    const mspUser = createMockUser('internal', { user_id: mspUserId, tenant: tenantId });
    const grants = new Set(['document:read', 'document:create', 'document:update', 'project:update', 'project_task:update']);
    setMockUser(mspUser, [...grants]);
    setupCommonMocks({
      tenantId, userId: mspUserId, user: mspUser,
      permissionCheck: (_user, resource, action) => grants.has(`${resource}:${action}`),
    });

    mspStorageProviderId = uuidv4();
    mspStorageConfigurationId = uuidv4();
    await table('storage_providers').insert({
      tenant: tenantId, provider_id: mspStorageProviderId, provider_type: 'local', provider_name: 'Concurrent folder test storage', config: {},
    });
    await table('storage_configurations').insert({
      tenant: tenantId, configuration_id: mspStorageConfigurationId, provider_id: mspStorageProviderId,
      name: 'Concurrent folder test storage', path: '/', is_default: true,
    });
    await table('document_default_folders').insert([
      { tenant: tenantId, default_folder_id: uuidv4(), entity_type: 'project_task', folder_path: '/Concurrent Tasks', folder_name: 'Concurrent Tasks', sort_order: 0, is_client_visible: false },
      { tenant: tenantId, default_folder_id: uuidv4(), entity_type: 'project_task', folder_path: '/Concurrent Tasks/Deliverables', folder_name: 'Deliverables', sort_order: 1, is_client_visible: false },
      { tenant: tenantId, default_folder_id: uuidv4(), entity_type: 'project_task', folder_path: '/Concurrent Tasks/Specifications', folder_name: 'Specifications', sort_order: 2, is_client_visible: false },
      { tenant: tenantId, default_folder_id: uuidv4(), entity_type: 'project_task', folder_path: '/Concurrent Tasks/Reference', folder_name: 'Reference', sort_order: 3, is_client_visible: false },
    ]);

    storageMocks.deleteFile.mockClear();
    storageMocks.uploadFile.mockImplementation(async (_tenant: string, buffer: Buffer, fileName: string) => {
      const fileId = uuidv4();
      trackedStorageFileIds.push(fileId);
      await table('external_files').insert({
        tenant: tenantId, file_id: fileId, file_name: fileName, original_name: fileName, mime_type: 'text/plain',
        file_size: buffer.length, storage_path: `test/${fileId}`, uploaded_by_id: mspUserId,
      });
      return { file_id: fileId, storage_path: `test/${fileId}` };
    });

    const makeForm = (name: string) => {
      const form = new FormData();
      form.set('file', new File([name], name, { type: 'text/plain' }));
      return form;
    };
    const initializer = await db.transaction();
    const uploads: Array<ReturnType<typeof uploadDocument>> = [];
    try {
      const { rows: [{ pid: initializerPid }] } = await initializer.raw('select pg_backend_pid() as pid');
      const parentFolderId = uuidv4();
      // An uncommitted initializer is invisible to both uploads' folder reads,
      // but holds the unique keys their inserts must contend for.
      await tenantDb(initializer, tenantId).table('document_folders').insert([
        { tenant: tenantId, folder_id: parentFolderId, entity_id: taskAId, entity_type: 'project_task', folder_path: '/Concurrent Tasks', folder_name: 'Concurrent Tasks', parent_folder_id: null, created_by: mspUserId },
        ...['Deliverables', 'Specifications', 'Reference'].map((name) => ({
          tenant: tenantId, folder_id: uuidv4(), entity_id: taskAId, entity_type: 'project_task',
          folder_path: `/Concurrent Tasks/${name}`, folder_name: name, parent_folder_id: parentFolderId, created_by: mspUserId,
        })),
      ]);
      uploads.push(
        uploadDocument(makeForm('folder-concurrent-a.txt'), { userId: mspUserId, projectTaskId: taskAId }),
        uploadDocument(makeForm('folder-concurrent-b.txt'), { userId: mspUserId, projectTaskId: taskAId }),
      );
      const pendingUploads = Promise.allSettled(uploads);
      const deadline = Date.now() + 10_000;
      let blockedUploads = 0;
      while (Date.now() < deadline) {
        const { rows: [{ count }] } = await db.raw(`
          select count(*)::int as count from pg_stat_activity
          where datname = current_database() and ? = any(pg_blocking_pids(pid))
        `, [initializerPid]);
        blockedUploads = count;
        if (blockedUploads === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blockedUploads).toBe(2);
      await initializer.commit();
      for (const result of await pendingUploads) {
        expect(result.status).toBe('fulfilled');
        if (result.status === 'fulfilled') expect(result.value).toHaveProperty('success', true);
      }
    } finally {
      if (!initializer.isCompleted()) await initializer.rollback();
      await Promise.allSettled(uploads);
    }
    const uploaded = await table('documents').where({ created_by: mspUserId })
      .whereIn('document_name', ['folder-concurrent-a.txt', 'folder-concurrent-b.txt'])
      .select('document_id', 'document_name', 'file_id');
    expect(uploaded).toHaveLength(2);
    expect(await table('document_associations').whereIn('document_id', uploaded.map((row: { document_id: string }) => row.document_id))
      .andWhere({ entity_type: 'project_task', entity_id: taskAId })).toHaveLength(2);
    expect(await table('document_folders').where({ entity_id: taskAId })).toHaveLength(4);
    expect(await table('external_files').whereIn('file_id', uploaded.map((row: { file_id: string }) => row.file_id))).toHaveLength(2);
    expect(storageMocks.deleteFile).not.toHaveBeenCalled();
  });

  it('keeps task and asset search authorization in SQL at representative scale', async () => {
    const taskA = await table('project_tasks').where({ task_id: taskAId }).select('phase_id').first();
    const taskB = await table('project_tasks').where({ task_id: taskBId }).select('phase_id').first();
    const taskRows: Array<Record<string, unknown>> = [];
    const assetRows: Array<Record<string, unknown>> = [];
    const assetAssociationRows: Array<Record<string, unknown>> = [];
    const authorizedTaskIds: string[] = [];
    const authorizedAssetIds: string[] = [];
    const taskMatchIds: string[] = [];
    const assetMatchIds: string[] = [];
    const timestamp = new Date('2026-01-01T00:00:00.000Z');
    const scaleId = (index: number) => `ffffffff-ffff-4fff-bfff-${index.toString(16).padStart(12, '0')}`;
    for (let index = 0; index < 20_000; index++) {
      const clientIndex = index % 2;
      const taskId = scaleId(index);
      const assetId = scaleId(index);
      const isSparseMatch = index >= 19_984;
      const taskName = isSparseMatch ? `scale-needle-task-${index}` : `scale-background-task-${index}`;
      const assetName = isSparseMatch ? `scale-needle-asset-${index}` : `scale-background-asset-${index}`;
      taskRows.push({
        tenant: tenantId, task_id: taskId, phase_id: clientIndex === 0 ? taskA.phase_id : taskB.phase_id,
        task_name: taskName, wbs_code: `scale-${index}`, updated_at: timestamp,
      });
      assetRows.push({
        tenant: tenantId, asset_id: assetId, asset_type: 'workstation',
        client_id: clientIndex === 0 ? clientAId : clientBId,
        asset_tag: `SCALE-${index}`, name: assetName, serial_number: `SCALE-SERIAL-${index}`, status: 'active',
      });
      assetAssociationRows.push({
        tenant: tenantId, asset_id: assetId, entity_type: 'user',
        entity_id: clientIndex === 0 ? clientAUserId : clientBUserId, created_by: mspUserId,
      });
      if (clientIndex === 0) {
        authorizedTaskIds.push(taskId);
        authorizedAssetIds.push(assetId);
      }
      if (isSparseMatch && clientIndex === 0) {
        taskMatchIds.push(taskId);
        assetMatchIds.push(assetId);
      }
    }
    for (let index = 0; index < taskRows.length; index += 500) {
      await table('project_tasks').insert(taskRows.slice(index, index + 500));
      await table('assets').insert(assetRows.slice(index, index + 500));
      await table('asset_associations').insert(assetAssociationRows.slice(index, index + 500));
    }

    const clientUser = createMockUser('client', {
      user_id: clientAUserId, tenant: tenantId, clientId: clientAId, contact_id: clientAContactId,
    });
    const permissions = new Set(['document:read', 'project:read', 'asset:read']);
    setMockUser(clientUser, [...permissions]);
    setupCommonMocks({ tenantId, userId: clientAUserId, user: clientUser,
      permissionCheck: (_user, resource, action) => permissions.has(`${resource}:${action}`) });

    const captured: Array<{ sql: string; bindings: unknown[] }> = [];
    const transferredRootRows: number[] = [];
    const searchTimings: Array<{ entityType: string; search: string; page: number; milliseconds: number }> = [];
    const onQuery = (query: { sql: string; bindings: unknown[] }) => {
      if (/from\s+"(?:project_tasks|assets)"/i.test(query.sql)) captured.push(query);
    };
    const onQueryResponse = (response: unknown, query: { sql: string }) => {
      if (!/from\s+"(?:project_tasks|assets)"/i.test(query.sql)) return;
      transferredRootRows.push(Array.isArray(response) ? response.length : response ? 1 : 0);
    };
    db.on('query', onQuery);
    db.on('query-response', onQueryResponse);
    const startedAt = Date.now();
    const bundleService = await import('@alga-psa/authorization/bundles/service');
    const relationalAssetRule = vi.spyOn(bundleService, 'resolveBundleNarrowingRulesForEvaluation').mockImplementation(async (_trx, input) =>
      input.resource.type === 'asset' && input.resource.action === 'read'
        ? [{ id: 'scale-owned-or-managed-assets', resource: 'asset', action: 'read', templateKey: 'own_or_managed' }]
        : []
    );
    try {
      for (const entityType of ['project_task', 'asset'] as const) {
        let queryStarted = Date.now();
        const needle = await searchDocumentAssociationEntities(entityType, 'scale-needle', 1, 10);
        searchTimings.push({ entityType, search: 'scale-needle', page: 1, milliseconds: Date.now() - queryStarted });
        queryStarted = Date.now();
        const firstPage = await searchDocumentAssociationEntities(entityType, 'scale-', 1, 5);
        searchTimings.push({ entityType, search: 'scale-', page: 1, milliseconds: Date.now() - queryStarted });
        queryStarted = Date.now();
        const laterPage = await searchDocumentAssociationEntities(entityType, 'scale-', 2, 5);
        searchTimings.push({ entityType, search: 'scale-', page: 2, milliseconds: Date.now() - queryStarted });
        const expected = entityType === 'project_task' ? taskMatchIds : assetMatchIds;
        expect(needle.total).toBe(8);
        expect(needle.options.map((item: { value: string }) => item.value).sort()).toEqual(expected.sort());
        expect(firstPage.total).toBe(10_000);
        expect(firstPage.options).toHaveLength(5);
        expect(laterPage.total).toBe(10_000);
        expect(laterPage.options).toHaveLength(5);
        const authorizedIds = entityType === 'project_task' ? authorizedTaskIds : authorizedAssetIds;
        expect([...firstPage.options, ...laterPage.options].every((item: { value: string }) => authorizedIds.includes(item.value))).toBe(true);
      }
    } finally {
      relationalAssetRule.mockRestore();
      db.removeListener('query', onQuery);
      db.removeListener('query-response', onQueryResponse);
    }

    const searchQueries = captured.filter((query) => /count\s*\(distinct|limit/i.test(query.sql));
    const parameterCounts = searchQueries.map((query) => query.bindings.length);
    const plans = [];
    const connection = await db.client.acquireConnection();
    try {
      for (const entityType of ['project_tasks', 'assets']) {
        const candidate = searchQueries.find((query) => query.sql.includes(`"${entityType}"`) &&
          /count\s*\(distinct/i.test(query.sql) && query.bindings.includes('%scale-%'));
        if (candidate) {
          await connection.query("SELECT set_config('app.current_tenant', $1, false)", [tenantId]);
          const explained = await connection.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${candidate.sql}`, candidate.bindings);
          plans.push({ entityType, plan: explained.rows.map((row: { 'QUERY PLAN': string }) => row['QUERY PLAN']) });
        }
      }
    } finally {
      await connection.query('RESET app.current_tenant');
      await db.client.releaseConnection(connection);
    }
    console.info('DOCUMENT_ASSOCIATION_SEARCH_SCALE', JSON.stringify({
      tasks: { total: 20_000, perClient: 10_000, authorizedNeedleMatches: 8 },
      assets: {
        total: 20_000, perClient: 10_000, authorizedNeedleMatches: 8,
        userOwnershipAssociations: assetAssociationRows.length,
        readRule: 'own_or_managed',
        ownersPerClient: 10_000,
      },
      capturedSearchStatements: searchQueries.length,
      maxSqlParameters: Math.max(0, ...parameterCounts),
      databaseRowsTransferred: { maxPerSearchStatement: Math.max(0, ...transferredRootRows), statements: transferredRootRows.length },
      applicationResultSizes: { selectivePage: 8, broadCount: 10_000, firstPage: 5, laterPage: 5 },
      searchTimings,
      elapsedMilliseconds: Date.now() - startedAt,
      plans,
    }));
    expect(searchQueries.length).toBeGreaterThanOrEqual(12);
    expect(Math.max(...parameterCounts)).toBeLessThan(20);
    expect(transferredRootRows.length).toBe(searchQueries.length);
    expect(Math.max(...transferredRootRows)).toBeLessThanOrEqual(8);

    const scaleAssetIdsQuery = table('assets').where('asset_tag', 'like', 'SCALE-%').select('asset_id');
    await table('asset_associations').whereIn('asset_id', scaleAssetIdsQuery).del();
    await table('assets').where('asset_tag', 'like', 'SCALE-%').del();
    await table('project_tasks').where('task_name', 'like', 'scale-%').del();

  }, 120_000);
});
