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
let clientAId: string;
let clientBId: string;
let clientAUserId: string;
let clientBUserId: string;
let taskAId: string;
let taskBId: string;
let ticketBId: string;
let ticketAVisibleId: string;
let ticketAVisibleSecondId: string;
let ticketAHiddenBoardId: string;
let clientAContactId: string;
let visibleBoardId: string;
let hiddenBoardId: string;
let visibilityGroupId: string;
let contractBId: string;
let quoteBId: string;
let opportunityBId: string;
let documentAId: string;
let documentBId: string;
let statusOrder = 0;
let mspStorageProviderId: string;
let mspStorageConfigurationId: string;
let mspUploadedFileId: string;

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
    taskBId = await seedProjectTask(clientBId, 'Client B secret task');
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
      const uploadedDocuments = await table('documents').where({ created_by: mspUserId, document_name: 'msp-cross-client.txt' }).select('document_id');
      const uploadedIds = uploadedDocuments.map((document: { document_id: string }) => document.document_id);
      if (uploadedIds.length) {
        await table('document_associations').whereIn('document_id', uploadedIds).del();
        await table('documents').whereIn('document_id', uploadedIds).del();
      }
      if (mspUploadedFileId) await table('external_files').where({ file_id: mspUploadedFileId }).del();
      await table('document_folders').whereIn('entity_id', [taskAId, taskBId]).del();
      if (mspStorageConfigurationId) await table('storage_configurations').where({ configuration_id: mspStorageConfigurationId }).del();
      if (mspStorageProviderId) await table('storage_providers').where({ provider_id: mspStorageProviderId }).del();
      await table('tickets').whereIn('ticket_id', [ticketBId, ticketAVisibleId, ticketAVisibleSecondId, ticketAHiddenBoardId]).del();
      await table('client_portal_visibility_group_boards').where({ group_id: visibilityGroupId }).del();
      await table('client_portal_visibility_groups').where({ group_id: visibilityGroupId }).del();
      await table('quotes').where({ quote_id: quoteBId }).del();
      await table('opportunities').where({ opportunity_id: opportunityBId }).del();
      await table('client_contracts').where({ contract_id: contractBId }).del();
      await table('contracts').where({ contract_id: contractBId }).del();
      await table('boards').whereIn('board_id', [visibleBoardId, hiddenBoardId]).del();
      const projects = await table('projects').whereIn('client_id', [clientAId, clientBId]).pluck('project_id');
      const phases = projects.length ? await table('project_phases').whereIn('project_id', projects).select('phase_id') : [];
      const phaseIds = phases.map((phase: { phase_id: string }) => phase.phase_id);
      if (phaseIds.length) await table('project_tasks').whereIn('phase_id', phaseIds).del();
      if (phaseIds.length) await table('project_phases').whereIn('phase_id', phaseIds).del();
      if (projects.length) await table('project_status_mappings').whereIn('project_id', projects).del();
      if (projects.length) await table('projects').whereIn('project_id', projects).del();
      await table('statuses').where('created_by', mspUserId).andWhere('status_type', 'project').del();
      await table('users').whereIn('user_id', [clientAUserId, clientBUserId]).del();
      await table('contacts').whereIn('client_id', [clientAId, clientBId]).del();
      await table('clients').whereIn('client_id', [clientAId, clientBId]).del();
    }
    await db?.destroy();
  });

  afterEach(async () => {
    if (!db || !tenantId) return;
    await table('document_associations').where({ document_id: documentAId }).del();
    await table('document_associations').insert({
      tenant: tenantId, association_id: uuidv4(), document_id: documentAId,
      entity_type: 'client', entity_id: clientAId, created_at: new Date(),
    });
    const uploadedDocuments = await table('documents').where({ created_by: mspUserId, document_name: 'msp-cross-client.txt' }).select('document_id');
    const uploadedIds = uploadedDocuments.map((document: { document_id: string }) => document.document_id);
    if (uploadedIds.length) {
      await table('document_associations').whereIn('document_id', uploadedIds).del();
      await table('documents').whereIn('document_id', uploadedIds).del();
    }
    if (mspUploadedFileId) await table('external_files').where({ file_id: mspUploadedFileId }).del();
    await table('document_folders').whereIn('entity_id', [taskAId, taskBId]).del();
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
      'asset:read', 'project:read', 'project:update', 'billing:read', 'billing:update', 'opportunities:read', 'opportunities:update',
    ]);
    setMockUser(clientUser, [...clientPermissions]);
    setupCommonMocks({ tenantId, userId: clientAUserId, user: clientUser, permissionCheck: (_user, resource, action) => clientPermissions.has(`${resource}:${action}`) });


    const hiddenTask = await searchDocumentAssociationEntities('project_task', 'Client B secret task', 1, 50);
    expect(hiddenTask).toEqual({ options: [], total: 0 });
    const ownTask = await searchDocumentAssociationEntities('project_task', 'Client A task', 1, 50);
    expect(ownTask.options.map((item: { value: string }) => item.value)).toContain(taskAId);
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
      'document:read', 'document:create', 'document:update', 'project:read', 'project:update', 'billing:read',
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
    const uploadForm = new FormData();
    uploadForm.set('file', new File(['MSP cross-client upload'], 'msp-cross-client.txt', { type: 'text/plain' }));
    const authorizedUpload = await uploadDocument(uploadForm, { userId: mspUserId, projectTaskId: taskBId });
    expect(authorizedUpload).toHaveProperty('success', true);
    const uploaded = await table('documents').where({ created_by: mspUserId, document_name: 'msp-cross-client.txt' }).first();
    expect(uploaded).toBeDefined();
    if (!uploaded) throw new Error('Expected authorized MSP upload to persist its document');
    expect(await table('document_associations').where({ document_id: uploaded.document_id, entity_id: taskBId })).toHaveLength(1);
  });

  it('requires document:update for association mutations and parent-document uploads even when read/create are granted', async () => {
    const clientUser = createMockUser('client', {
      user_id: clientAUserId, tenant: tenantId, clientId: clientAId, contact_id: clientAContactId,
    });
    const grants = new Set(['document:read', 'document:create', 'project:update']);
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
      'document:read', 'document:create', 'document:update', 'project:read', 'project:update',
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
});
